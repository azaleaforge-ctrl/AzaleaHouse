//! Local Windows hardware inventory for hardware-aware Ollama recommendations.
//!
//! This runs a fixed, read-only PowerShell/CIM query. No user-supplied command text
//! is accepted, and the inventory stays on the device.

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub vram_bytes: Option<u64>,
    pub vram_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub cpu_name: String,
    pub cpu_cores: u32,
    pub logical_processors: u32,
    pub ram_total_bytes: u64,
    pub ram_available_bytes: u64,
    pub gpus: Vec<GpuInfo>,
    pub disk_available_bytes: u64,
    pub os_name: String,
    pub scanned_at_unix_ms: u128,
}

#[tauri::command]
pub async fn scan_hardware() -> Result<HardwareInfo, String> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(scan_windows_hardware)
            .await
            .map_err(|error| format!("Pemindaian hardware gagal dimulai: {error}"))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Pemindaian spesifikasi hardware saat ini hanya didukung di Windows.".to_owned())
    }
}

#[cfg(target_os = "windows")]
fn scan_windows_hardware() -> Result<HardwareInfo, String> {
    use std::os::windows::process::CommandExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // This script only reads standard Windows CIM data. NVIDIA VRAM is replaced
    // with nvidia-smi data when that official utility is available because the
    // Win32_VideoController AdapterRAM field is only 32-bit and can be capped.
    let script = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$systemDrive = $env:SystemDrive
$disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $systemDrive + "'") | Select-Object -First 1
$gpus = @(
  Get-CimInstance -ClassName Win32_VideoController | ForEach-Object {
    $vram = $null
    $source = $null
    if ($null -ne $_.AdapterRAM) {
      $candidate = [uint64]$_.AdapterRAM
      if ($candidate -gt 0 -and $candidate -lt 4000000000) {
        $vram = $candidate
        $source = 'WMI (perkiraan)'
      }
    }
    [PSCustomObject]@{
      name = [string]$_.Name
      vramBytes = $vram
      vramSource = $source
    }
  }
)
if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {
  try {
    $rows = @(nvidia-smi.exe --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null)
    foreach ($row in $rows) {
      $parts = ([string]$row).Split(',')
      if ($parts.Count -ge 2) {
        $gpuName = $parts[0].Trim()
        $memoryMb = [int64]0
        if ([int64]::TryParse($parts[$parts.Count - 1].Trim(), [ref]$memoryMb) -and $memoryMb -gt 0) {
          foreach ($gpu in $gpus) {
            if ($gpu.name -match 'NVIDIA' -and ($gpu.name -eq $gpuName -or $gpu.name -like ($gpuName + '*'))) {
              $gpu.vramBytes = [int64]$memoryMb * 1MB
              $gpu.vramSource = 'nvidia-smi'
              break
            }
          }
        }
      }
    }
  } catch {}
}
$result = [PSCustomObject]@{
  cpuName = [string]$cpu.Name
  cpuCores = [uint32]$cpu.NumberOfCores
  logicalProcessors = [uint32]$cpu.NumberOfLogicalProcessors
  ramTotalBytes = [int64]$os.TotalVisibleMemorySize * 1024
  ramAvailableBytes = [int64]$os.FreePhysicalMemory * 1024
  gpus = @($gpus)
  diskAvailableBytes = [int64]$disk.FreeSpace
  osName = [string]$os.Caption
}
$result | ConvertTo-Json -Depth 5 -Compress
"#;

    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Tidak dapat menjalankan pemindai hardware Windows: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Windows gagal membaca spesifikasi PC: {}",
            stderr.trim().chars().take(500).collect::<String>()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json = stdout.trim().trim_start_matches('\u{feff}');
    if json.is_empty() {
        return Err("Windows tidak mengembalikan data spesifikasi hardware.".to_owned());
    }

    let mut info: HardwareInfo = serde_json::from_str(json)
        .map_err(|error| format!("Data hardware Windows tidak dapat dibaca: {error}"))?;

    if info.cpu_cores == 0 || info.logical_processors == 0 || info.ram_total_bytes == 0 {
        return Err("Spesifikasi CPU/RAM yang dikembalikan Windows tidak lengkap.".to_owned());
    }

    info.gpus.retain(|gpu| !gpu.name.trim().is_empty());
    info.scanned_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Jam sistem tidak valid: {error}"))?
        .as_millis();

    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::{GpuInfo, HardwareInfo};

    #[test]
    fn hardware_payload_uses_camel_case_json_fields() {
        let payload = HardwareInfo {
            cpu_name: "CPU".to_owned(),
            cpu_cores: 4,
            logical_processors: 8,
            ram_total_bytes: 8_000_000_000,
            ram_available_bytes: 4_000_000_000,
            gpus: vec![GpuInfo {
                name: "GPU".to_owned(),
                vram_bytes: Some(2_000_000_000),
                vram_source: Some("test".to_owned()),
            }],
            disk_available_bytes: 10_000_000_000,
            os_name: "Windows".to_owned(),
            scanned_at_unix_ms: 1,
        };
        let value = serde_json::to_value(payload).expect("serialize hardware info");
        assert_eq!(value["ramTotalBytes"], 8_000_000_000u64);
        assert_eq!(value["gpus"][0]["vramBytes"], 2_000_000_000u64);
        assert_eq!(value["cpuCores"], 4);
    }
}
