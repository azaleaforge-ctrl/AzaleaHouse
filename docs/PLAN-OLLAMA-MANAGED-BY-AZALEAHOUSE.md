# AzaleaHouse — PRD & Implementation Plan: Ollama Dikelola oleh Aplikasi

**Status:** Draft rencana implementasi untuk ditinjau; belum merupakan klaim bahwa runtime sudah terbundel.
**Target inisiatif:** setelah perbaikan streaming chat v0.1.9 stabil.
**Platform awal:** Windows x64, instalasi per pengguna.
**Dokumen terkait:** `AzaleaHouse-PRD.md`, `docs/DECISIONS.md`, `docs/PHASE-1-UPDATER-SECURITY.md`.

---

## 1. Ringkasan eksekutif

AzaleaHouse harus memberikan pengalaman seperti satu aplikasi desktop AI lokal. Pengguna memasang AzaleaHouse, membuka menu **AI Lokal**, memilih atau mengunduh model, kemudian langsung menggunakan chat tanpa harus membuka terminal, mengonfigurasi layanan, atau memasang Ollama secara manual.

Pada tahap ini, Ollama tetap menjadi inference runtime di bawah kendali AzaleaHouse. Aplikasi bertanggung jawab terhadap pemeriksaan runtime, bootstrap/pemasangan yang aman, siklus hidup proses, kesiapan API lokal, pengunduhan dan pengelolaan model melalui UI, status, diagnostik, serta pemulihan kesalahan. Inferensi tetap berlangsung di komputer pengguna melalui runtime lokal, bukan di server cloud Ollama.

Dokumen ini **tidak** mengusulkan pembuatan mesin inferensi dari nol dan **tidak** memindahkan implementasi ke llama.cpp pada fase pertama. Lapisan runtime harus dipisahkan agar migrasi ke engine lain tetap mungkin pada masa mendatang.

### Keputusan arsitektur awal yang direkomendasikan

1. Pertahankan Ollama sebagai engine inferensi untuk rilis awal manajemen runtime.
2. Otomatiskan setup dan pengelolaan Ollama dari AzaleaHouse; pengguna tidak perlu mengoperasikan Ollama secara manual.
3. Jangan menyertakan bobot model di installer AzaleaHouse. Model diunduh atas tindakan pengguna karena ukurannya besar dan dapat berbeda sesuai perangkat/kebutuhan.
4. Pertahankan kompatibilitas dengan model Ollama yang sudah ada. Jangan menyalin, memindahkan, atau menghapus model lama secara diam-diam.
5. Semua operasi privileged berjalan melalui command Tauri/Rust yang divalidasi, bukan string shell bebas dari frontend.
6. Tetap pertahankan UI, riwayat, pengaturan, serta format event chat yang sudah ada selama kontrak backend dapat dipertahankan.

---

## 2. Latar belakang dan masalah pengguna

Implementasi saat ini menggunakan endpoint Ollama lokal, termasuk `http://127.0.0.1:11434/api/chat`, `/api/tags`, `/api/pull`, dan `/api/generate`. Secara teknis, inferensi berlangsung secara lokal, tetapi pengalaman produk masih terasa bergantung pada program terpisah:

- pengguna mungkin perlu memasang dan menjalankan Ollama sendiri;
- UI perlu menjelaskan status runtime dan model secara konsisten;
- layanan belum memiliki satu alur bootstrap, readiness, recovery, dan shutdown yang dikendalikan produk;
- error runtime dapat terlihat seperti error chat tanpa arahan tindakan yang jelas;
- instalasi ulang atau migrasi runtime dapat membingungkan jika lokasi model tidak diidentifikasi;
- update aplikasi dan update runtime merupakan dua lifecycle berbeda yang harus dijelaskan dengan benar.

Perbaikan streaming chat v0.1.9 adalah pekerjaan terpisah dan wajib. Mengelola runtime tidak boleh digunakan untuk menutupi parser yang salah membaca format streaming Ollama.

---

## 3. Tujuan produk

### 3.1 Tujuan utama

- Pengguna tidak harus memasang atau menjalankan Ollama secara manual.
- Runtime lokal siap sebelum chat dimulai, atau UI menjelaskan aksi yang diperlukan.
- Model dapat dicari, diunduh, dimuat, dilepas dari RAM, dan dihapus melalui AzaleaHouse.
- Status **runtime**, **model terunduh**, **model termuat di RAM**, dan **chat berjalan** adalah status yang berbeda.
- Chat berjalan di komputer pengguna setelah model/runtime tersedia.
- Kegagalan runtime tidak boleh menghilangkan riwayat percakapan atau membuat aplikasi macet.
- Pemulihan dan diagnostik tersedia tanpa memaksa pengguna memahami command line.
- Arsitektur backend dapat mendukung runtime alternatif di masa mendatang tanpa merombak UI.

### 3.2 Bukan tujuan fase awal

- Membuat model fondasi atau mesin inferensi baru dari nol.
- Mengirim prompt, konten chat, berkas pengguna, atau bobot model ke server AzaleaHouse.
- Mengemas semua model AI ke dalam installer utama.
- Menjalankan installer atau proses elevated tanpa izin pengguna.
- Menghapus Ollama yang telah dipasang pengguna.
- Menghapus atau mengonversi cache model tanpa persetujuan dan verifikasi.
- Mendukung semua format/model yang tersedia di internet tanpa katalog kompatibilitas.
- Mengklaim semua model mendukung vision, thinking, tool use, atau fitur lain berdasarkan nama saja.

---

## 4. Terminologi dan kontrak produk

| Istilah | Arti di AzaleaHouse |
|---|---|
| AzaleaHouse app | UI desktop, backend Rust, penyimpanan, dan pengelola runtime |
| Runtime | Proses lokal yang menjalankan inferensi; pada fase ini Ollama |
| Model | Bobot dan metadata model yang dapat dimuat runtime |
| Model downloaded | File model tersedia dan terdaftar di runtime |
| Model loaded | Runtime melaporkan model berada dalam memori/siap digunakan |
| Runtime ready | Endpoint lokal memberi respons valid dan runtime yang benar terdeteksi |
| Managed runtime | Runtime yang lifecycle-nya diluncurkan dan dicatat oleh AzaleaHouse |
| Existing runtime | Ollama yang sudah berjalan/terpasang sebelum AzaleaHouse mengelolanya |
| Local-only inference | Prompt dan inferensi tidak diarahkan ke layanan cloud; unduhan model tetap memerlukan internet |
| Bootstrap | Tahap memasang atau memperoleh runtime yang dibutuhkan aplikasi |
| Readiness check | Pemeriksaan berulang sampai API menjawab valid, timeout tercapai, atau pengguna membatalkan |

**Pembedaan penting:** "dikelola oleh AzaleaHouse" berarti pengguna berinteraksi melalui aplikasi dan aplikasi mengontrol lifecycle yang aman. Hal itu tidak berarti model Ollama otomatis berubah menjadi format internal AzaleaHouse. Selama fase ini, Ollama tetap memiliki format, katalog, dan tata cara pengelolaan modelnya.

---

## 5. Pengalaman pengguna yang dituju

### 5.1 Peluncuran pertama

1. AzaleaHouse memulai tanpa menggantung UI.
2. Backend mendeteksi apakah runtime yang kompatibel sudah tersedia dan API lokal siap.
3. Jika tersedia, aplikasi memeriksa daftar model dan memulihkan status UI.
4. Jika tidak tersedia, layar AI Lokal menampilkan **Siapkan runtime lokal** disertai ukuran unduhan, sumber resmi, ruang disk yang dibutuhkan, serta informasi bahwa tindakan ini memerlukan internet.
5. Pengguna menyetujui proses; AzaleaHouse mengunduh/menjalankan prosedur setup yang sudah diverifikasi.
6. AzaleaHouse menunggu readiness check dengan timeout, pembatalan, dan detail diagnostik.
7. Setelah runtime siap, pengguna memilih atau mengunduh model.
8. Setelah model tersedia, chat dapat dimulai.

### 5.2 Peluncuran berikutnya

- Aplikasi memeriksa apakah runtime yang dikelola masih hidup.
- Jika sudah siap, jangan meluncurkan salinan runtime kedua.
- Jika mati, AzaleaHouse hanya boleh menjalankan ulang proses yang aman dan teridentifikasi.
- Runtime eksternal yang tidak dimulai oleh AzaleaHouse tidak boleh dipaksa dihentikan.
- Jika runtime hilang atau rusak, tampilkan **Perbaiki runtime** dengan pilihan pemulihan yang jelas.

### 5.3 Mengunduh model

- Pengguna memilih model dari katalog dengan nama, varian, ukuran download, perkiraan ruang disk, dukungan fitur yang diverifikasi, sumber, dan catatan kompatibilitas.
- Tombol unduh memulai aksi eksplisit.
- UI memperlihatkan progres byte, persentase bila total diketahui, laju download jika dapat dihitung, status tahap, dan pembatalan.
- Kegagalan download menampilkan penyebab yang dapat ditindaklanjuti dan tombol coba lagi.
- Download yang gagal tidak boleh ditampilkan sebagai model siap pakai.

### 5.4 Mengirim pesan chat

- Chat tidak dimulai sebelum runtime dan model target siap.
- UI mengunci/mengatur tombol kirim dengan state yang konsisten saat request dimulai.
- Token/chunk ditampilkan secara streaming.
- Penanda selesai yang valid diperlukan untuk menandai respons sukses.
- Error stream berbeda dari respons selesai normal dan dari pembatalan pengguna.
- Riwayat disimpan sesuai sistem penyimpanan lokal yang sudah ada; masalah runtime tidak menghapus percakapan.
- Jika runtime berhenti di tengah generasi, teks parsial tetap ditandai parsial dan pesan kesalahan tidak menyatakan respons selesai.

### 5.5 Menonaktifkan runtime

- Menu Settings menyediakan aksi **Matikan runtime** untuk proses yang dikelola aplikasi.
- Jika runtime adalah proses eksternal yang sudah berjalan sebelum AzaleaHouse dibuka, aplikasi tidak menghentikannya secara otomatis.
- Status model yang berada di RAM mungkin berubah ketika runtime dihentikan; file model yang sudah diunduh tetap ada.
- Menutup aplikasi tidak boleh membunuh proses yang bukan milik lifecycle AzaleaHouse.

---

## 6. Arsitektur target

### 6.1 Pemisahan tanggung jawab

**Frontend React/TypeScript**
- Mengelola tampilan, status, notifikasi, dan interaksi.
- Menggunakan kontrak command/event yang stabil.
- Tidak menjalankan shell command atau mengakses path arbitrary secara langsung.
- Tidak mengimplementasikan logika download/runtime yang privileged.

**Tauri/Rust command layer**
- Memvalidasi aksi pengguna.
- Menjadi API terkontrol antara UI dan runtime supervisor.
- Memancarkan event status, progress, log ringkas, serta hasil operasi.
- Menjamin operasi runtime dan operasi model tidak saling bertabrakan.

**Runtime supervisor**
- Mendeteksi runtime dan endpoint lokal.
- Memulai managed runtime ketika diperlukan.
- Memastikan hanya satu startup attempt per waktu.
- Menyimpan PID/identitas child process dan asal proses.
- Melakukan readiness check, heartbeat, restart terbatas, dan shutdown terkontrol.
- Membedakan proses yang dimulai AzaleaHouse dari proses eksternal.

**Ollama adapter**
- Membungkus operasi HTTP lokal: versi/status, daftar model, model pull/delete, daftar model yang loaded, chat, serta operasi lifecycle yang didukung.
- Mengubah respons Ollama menjadi tipe data internal yang stabil.
- Memusatkan timeout, error mapping, validasi status, dan parsing stream.
- Tidak menyebarkan skema HTTP mentah ke setiap komponen UI.

**Model catalog & policy**
- Menentukan sumber resmi model yang diizinkan.
- Menyimpan metadata fitur yang ditinjau, tidak hanya mengandalkan heuristik nama.
- Memisahkan metadata katalog dari keadaan aktual runtime.
- Memungkinkan model lokal tambahan tetap terdeteksi walaupun tidak ada di katalog rekomendasi.

**Local storage**
- Percakapan dan pengaturan tetap berada di penyimpanan AzaleaHouse yang sudah dirancang.
- File model mengikuti lokasi runtime Ollama pada fase awal, kecuali opsi konfigurasi yang sudah diverifikasi.
- Runtime logs dan cache sementara berada di lokasi aplikasi yang terpisah dari riwayat chat.

### 6.2 Gambaran alur

```text
AzaleaHouse UI
      |
      v
Tauri Commands / Typed Events
      |
      v
AI Runtime Service
      |
      +---- Runtime Supervisor
      |          |
      |          +---- Process lifecycle / readiness
      |
      +---- Ollama Adapter ----> Ollama API at 127.0.0.1:11434
      |                                  |
      |                                  v
      |                            Local model files
      |
      +---- Model Catalog / Policy
      |
      +---- Diagnostics / Local logs
```

### 6.3 Kontrak internal yang disarankan

Buat tipe internal semacam:

- `RuntimeStatus`: `not_installed`, `starting`, `ready`, `unavailable`, `error`, `stopping`.
- `RuntimeOwnership`: `managed_by_app`, `external_detected`, `unknown`.
- `ModelStatus`: `not_downloaded`, `downloading`, `downloaded`, `loading`, `loaded`, `unloading`, `error`.
- `RuntimeDiagnostic`: kode error, ringkasan ramah pengguna, detail teknis yang aman, aksi yang direkomendasikan.
- `ChatStreamEvent`: `started`, `chunk`, `thinking`, `completed`, `cancelled`, `failed`.

Nama dan skema final ditentukan saat implementasi. Jangan membuat status frontend yang bertentangan dengan status runtime nyata.

### 6.4 Batas jaringan lokal

- Endpoint runtime default hanya pada loopback.
- AzaleaHouse tidak membuka listener ke LAN.
- Jangan menerima URL runtime arbitrary dari frontend.
- Redirect dan URL unduhan dibatasi ke sumber resmi yang diizinkan.
- Jika port default sedang digunakan, verifikasi bahwa API merespons sesuai kontrak yang diharapkan sebelum menganggap runtime siap.
- Jangan mematikan proses asing hanya karena port 11434 sedang dipakai.

---

## 7. Bootstrap, distribusi, dan versi runtime

Ini adalah keputusan yang harus diselesaikan pada tahap discovery dan proof-of-concept, bukan diasumsikan selesai oleh dokumen.

### 7.1 Kandidat strategi distribusi

**Strategi A — Runtime resmi diunduh/di-setup saat pertama kali dipakai**
- Installer utama AzaleaHouse tetap lebih kecil.
- Pengguna melihat proses persiapan runtime di UI.
- Memerlukan pemeriksaan ketersediaan format distribusi, silent setup yang didukung, syarat lisensi, signature, dan jalur uninstall.
- Prosedur tidak boleh mengunduh executable tanpa validasi sumber dan identitas penanda tangan.

**Strategi B — Runtime kompatibel dibundel dengan installer AzaleaHouse**
- Pengalaman offline/first run bisa lebih konsisten setelah installer tersedia.
- Ukuran installer membesar dan pembaruan runtime mengikuti siklus rilis aplikasi.
- Memerlukan tinjauan lisensi, redistribusi, dependensi, dan penandatanganan paket.

**Rekomendasi awal:** evaluasi Strategi A terlebih dahulu jika distribusi resmi memungkinkan setup per-user yang aman dan terotomasi. Jika tidak, pilih Strategi B setelah persyaratan distribusi diverifikasi. Keputusan wajib dicatat sebelum phase implementasi lanjut.

### 7.2 Aturan instalasi

- Gunakan versi runtime yang telah diuji; hindari selalu mengambil versi terbaru secara diam-diam.
- Verifikasi signature paket Windows atau mekanisme integritas resmi yang tersedia.
- Hindari meminta hak administrator jika mode per-user memadai.
- Installer runtime tidak boleh dijalankan dari path temporer sebelum validasi selesai.
- Simpan versi runtime yang diketahui kompatibel untuk diagnostik.
- Jika bootstrap gagal, jangan biarkan UI memulai chat seolah runtime sudah siap.
- Uninstall AzaleaHouse tidak otomatis menghapus model pengguna atau Ollama yang dipakai aplikasi lain.
- Jangan menjanjikan uninstall runtime pada fase awal hingga ownership dan kemungkinan pemakaian oleh aplikasi lain dapat dipastikan.

### 7.3 Pembaruan runtime

- Pembaruan AzaleaHouse dan pembaruan Ollama adalah lifecycle terpisah.
- Jangan memperbarui runtime ketika chat atau operasi model masih berjalan.
- Berikan notifikasi perubahan yang relevan dan kemungkinan kebutuhan restart.
- Pertahankan model dan history saat runtime diperbarui.
- Sediakan fallback atau petunjuk pemulihan jika runtime baru tidak bisa digunakan.
- Jangan mengganti runtime ke versi yang belum lulus smoke test model yang didukung.

---

## 8. Manajemen model dan penyimpanan

### 8.1 Sumber kebenaran

Pada fase pertama, katalog aktual model yang terunduh/termuat harus diverifikasi terhadap API runtime. Daftar rekomendasi AzaleaHouse sendiri hanya metadata produk, bukan bukti bahwa model telah ada secara lokal.

### 8.2 Kompatibilitas model

Untuk setiap entri katalog, catat:
- nama dan tag yang tepat;
- sumber dan lisensi model;
- ukuran download dan perkiraan ruang disk;
- arsitektur/format yang didukung runtime;
- dukungan teks, vision, thinking, context, dan kemampuan lain setelah divalidasi;
- konfigurasi default yang diuji;
- batas memori atau rekomendasi hardware, jika terukur;
- checksum atau metadata integritas jika sumber menyediakannya;
- tanggal/verifikasi kompatibilitas terakhir.

Jangan menyimpulkan kemampuan model hanya dari substring nama tanpa menandai data itu sebagai perkiraan.

### 8.3 Model yang sudah terpasang

- Pertahankan model dalam direktori yang sudah digunakan Ollama.
- Hindari men-download ulang model hanya karena AzaleaHouse mengubah UI atau versi.
- Jangan memindahkan folder model secara otomatis saat runtime dikelola.
- Jika pengguna sudah memiliki Ollama, berikan pilihan menggunakan runtime tersebut dan tampilkan statusnya secara jelas.
- Sebelum mengubah lokasi, hitung kebutuhan ruang dan sediakan proses migrasi dengan verifikasi serta rollback.

### 8.4 Menghapus model

- Hapus hanya model tepat yang dipilih pengguna dan telah divalidasi sebagai entri lokal.
- Tampilkan ukuran yang akan dibebaskan bila nilainya diketahui.
- Konfirmasi aksi destruktif.
- Jangan menyediakan penghapusan seluruh cache sebagai efek samping uninstall aplikasi.
- Jika model sedang dipakai, lakukan validasi lifecycle sebelum penghapusan.

### 8.5 Download model

- Download hanya setelah tindakan pengguna atau workflow yang jelas disetujui.
- Progres menunjukkan tahap dan status yang tepat.
- Pembatalan tidak boleh menandai model belum lengkap sebagai siap.
- Jika runtime mendukung resume, jelaskan bahwa percobaan ulang dapat melanjutkan data; jangan menjanjikan resume jika belum diverifikasi.
- Kegagalan harus menyimpan detail diagnostik yang aman serta menampilkan tindakan coba lagi.

---

## 9. Chat, streaming, dan siklus hidup model

### 9.1 Prasyarat chat

Sebelum memulai chat:
1. Runtime status `ready`.
2. Model yang dipilih terdaftar dan kompatibel.
3. Permintaan tidak bertabrakan dengan load/unload atau pull/delete yang belum selesai.
4. Model ditandai loaded atau dapat dimuat oleh runtime.
5. Handler event sudah terpasang sebelum worker memancarkan chunk pertama.

### 9.2 Kontrak streaming

- Parser membaca format streaming aktual dari endpoint runtime yang digunakan.
- Jangan mengasumsikan format SSE bila API mengirim NDJSON.
- Buffer parsial dipertahankan sampai pemisah record tiba.
- Buffer terakhir tetap diproses pada EOF bila berisi record valid.
- Respons dinyatakan selesai hanya ketika penanda final yang valid diterima.
- Jika socket benar-benar putus sebelum marker final, tampilkan error stream terputus.
- Pembatalan pengguna bukan error runtime.
- Jangan mengubah stream error menjadi sukses hanya untuk menyembunyikan notifikasi.
- Statistik token/waktu hanya dipublikasikan jika field sumber tersedia dan valid.

### 9.3 Pembatalan

- Cancel harus berfungsi ketika runtime sedang memuat model, menunggu header, atau sedang streaming.
- Worker dibersihkan pada setiap jalur: selesai, error, cancellation, dan early return.
- Registry stream tidak boleh menyimpan entri stale.
- Event dari stream lama tidak boleh memodifikasi sesi chat baru.
- Operasi lifecycle tidak boleh mematikan model saat generasi aktif.

### 9.4 Kebijakan RAM

- Pertahankan kebijakan saat ini sampai pengujian menunjukkan perilaku yang benar.
- Status loaded tidak boleh disamakan dengan runtime ready.
- Auto-unload tidak boleh terjadi saat stream/operasi aktif.
- UI harus menyebut bahwa unloading melepas bobot model dari RAM, bukan menghapus model di disk.
- Jika runtime gagal saat unload, baca kembali status sebelum memperbarui UI.

---

## 10. UX dan informasi status

### 10.1 Status yang tampak

Tampilkan status terpisah yang mudah dipahami:
- **Runtime lokal:** Belum disiapkan, Menyiapkan, Siap, Tidak merespons, Memperbaiki, Mematikan.
- **Model:** Belum diunduh, Mengunduh, Tersedia, Memuat, Siap, Melepas dari memori, Gagal.
- **Chat:** Idle, Menghasilkan, Selesai, Dibatalkan, Terputus.

### 10.2 Isi error yang diharapkan

Setiap error menampilkan:
- ringkasan bahasa Indonesia;
- kode diagnostik stabil;
- detail teknis yang tidak memuat secret;
- aksi berikutnya, seperti Coba lagi, Mulai runtime, Perbaiki runtime, Pilih model, atau Buka log;
- status apakah history dan file model tetap aman.

### 10.3 Tidak boleh dilakukan

- Menggunakan label **Model siap** jika hanya API runtime yang hidup tetapi model target belum terdaftar.
- Menganggap keberadaan port sebagai bukti penuh identitas runtime.
- Menampilkan stack trace panjang sebagai satu-satunya pesan UI.
- Menampilkan progress palsu atau persentase tebakan sebagai angka aktual.
- Memulai banyak proses Ollama dari beberapa komponen UI.
- Memunculkan dialog berulang yang tidak dapat dipulihkan pengguna.

---

## 11. Privasi dan keamanan

- Inferensi harus tetap lokal.
- Tidak ada telemetri prompt atau respons secara default.
- Pemeriksaan update runtime tidak boleh mengirim isi percakapan.
- Download hanya dari sumber HTTPS resmi/allow-listed.
- Validasi signature/checksum artefak ketika sumber menyediakan mekanisme resmi.
- Jangan menyimpan token, URL bertanda tangan, atau secret pada log.
- Jangan membuat fungsi shell arbitrer dari frontend.
- Gunakan allowlist perintah, argumen, dan path.
- Proses child harus menggunakan pemanggilan executable dan argumen terpisah, bukan command string yang digabungkan.
- PID/ownership harus diverifikasi sebelum terminasi proses.
- Batasi akses IPC pada command yang dibutuhkan.
- Jangan membuka API runtime ke alamat non-loopback.
- Laporkan dengan jelas bagian mana yang membutuhkan internet: bootstrap, download model, pemeriksaan update, dan download update.
- Jelaskan bahwa model/file yang sudah tersedia dapat digunakan offline, tetapi fitur yang bergantung pada jaringan tetap tidak tersedia.

---

## 12. Diagnostik dan pemulihan

Log lokal minimal merekam:
- timestamp dan phase lifecycle;
- versi AzaleaHouse dan runtime;
- apakah runtime dikelola aplikasi atau ditemukan sebagai proses eksternal;
- durasi readiness check;
- status operasi model dan kode error;
- hasil startup/shutdown tanpa prompt, isi dokumen, atau data sensitif.

Recovery flow:
1. Deteksi runtime tidak responsif.
2. Bedakan proses yang dikelola app dengan proses eksternal.
3. Jika proses managed berhenti, periksa exit code dan log terbatas.
4. Lakukan paling banyak satu restart otomatis untuk kegagalan startup yang aman.
5. Jika gagal lagi, hentikan retry otomatis dan tampilkan diagnostik.
6. Jangan mematikan runtime eksternal tanpa persetujuan.
7. Pertahankan history dan file model.
8. Berikan pilihan membuka folder log atau menyalin diagnostik yang sudah disaring.

---

## 13. Kontrak command/event yang harus diaudit

Sebelum mengubah frontend, audit semua pemakaian command berikut di repository:
- `runtime_status`
- `list_models`
- `pull_model`
- `delete_model`
- `chat_start`
- `chat_cancel`
- `load_model`
- `unload_model`

Target command baru yang mungkin diperlukan:
- `runtime_install_or_bootstrap`
- `runtime_start`
- `runtime_stop`
- `runtime_diagnostics`
- `runtime_version`
- `runtime_repair`

Nama tersebut adalah rancangan, belum kontrak final. Sebelum menambah command, cari apakah fungsi yang sama sudah ada. Semua command yang melakukan proses jangka panjang harus mendukung progress atau status yang dapat dipantau.

Event calon:
- `azalea:runtime_status`
- `azalea:runtime_progress`
- `azalea:model_pull_progress`
- `azalea:update_progress`
- `azalea:chat_started`
- `azalea:chat_chunk`
- `azalea:chat_done`
- `azalea:chat_error`

Jangan mengganti nama event yang dipakai UI tanpa kompatibilitas atau migrasi terpadu.

---

## 14. Rencana implementasi bertahap

### Phase 0 — Discovery dan baseline

**Tujuan:** menentukan distribusi runtime dan perilaku yang sudah ada sebelum perubahan lifecycle.

Pekerjaan:
- inventarisasi command, event, UI status, dan alur instalasi;
- verifikasi dokumentasi resmi distribusi Ollama Windows, mode per-user, silent install/portable support, signature, lisensi, dan uninstall;
- uji API runtime pada Windows bersih dan komputer dengan Ollama sudah tersedia;
- catat folder model aktual, konfigurasi, dan variabel environment yang didukung;
- ukur ukuran runtime dan waktu startup;
- pastikan CI berjalan dan buat checklist acceptance.

Exit criteria:
- strategi distribusi dipilih dengan alasan;
- tidak ada perilaku installer yang diasumsikan tanpa verifikasi;
- baseline versi runtime dan model uji tercatat;
- keputusan dicatat dalam `docs/DECISIONS.md`.

### Phase 1 — Runtime supervisor

**Tujuan:** mengelola runtime lifecycle tanpa mengubah fitur chat atau merusak model yang sudah ada.

Pekerjaan:
- membuat supervisor Rust dengan state machine yang eksplisit;
- mendeteksi runtime dan endpoint;
- membedakan `managed_by_app` dan `external_detected`;
- menjalankan runtime melalui executable/installer yang disetujui;
- menunggu readiness dengan timeout serta pembatalan;
- simpan proses yang dimiliki dan hentikan hanya proses tersebut;
- cegah double startup dan retry tak terbatas;
- tampilkan status dan error yang bisa ditindaklanjuti.

Exit criteria:
- cold start dan warm start lulus;
- port sibuk tidak menyebabkan proses asing terbunuh;
- runtime yang berhenti dapat didiagnosis;
- UI tetap responsif sepanjang bootstrap dan shutdown.

### Phase 2 — Pengelola runtime di Settings dan AI Lokal

**Tujuan:** membuat pengguna tidak perlu membuka terminal atau aplikasi Ollama untuk operasi normal.

Pekerjaan:
- tambahkan status runtime, versi, tombol Start/Stop/Repair;
- integrasikan bootstrap first-run dengan progress;
- tampilkan apakah runtime dikelola app atau eksternal;
- tampilkan lokasi model sesuai runtime sebenarnya;
- jelaskan restart runtime jika diperlukan;
- sediakan petunjuk error offline dan koneksi lokal.

Exit criteria:
- instalasi baru dapat mengikuti flow UI;
- instalasi lama tetap dapat menggunakan model yang ada;
- pengguna dapat mengidentifikasi masalah runtime dari UI;
- operasi tidak memengaruhi history.

### Phase 3 — Model Center

**Tujuan:** semua operasi model yang umum tersedia di AzaleaHouse.

Pekerjaan:
- katalog model dengan sumber, ukuran, format, lisensi, dan fitur tervalidasi;
- deteksi model yang sudah terpasang;
- pull dengan progress/cancellation;
- delete satu model dengan konfirmasi;
- status loaded/unloaded;
- kontrol disk space dan kesalahan download;
- tidak melakukan duplikasi file besar jika model sudah tersedia.

Exit criteria:
- model yang sudah terunduh terdeteksi secara konsisten;
- pull, cancel, retry, delete, dan load/unload diuji;
- model yang gagal tidak tampil siap;
- tidak ada penghapusan data diam-diam.

### Phase 4 — Stabilitas chat dan lifecycle

**Tujuan:** chat, streaming, dan runtime tidak saling merusak state.

Pekerjaan:
- parser NDJSON dan penanganan EOF final;
- penanda selesai, cancellation, dan errors dibedakan;
- cegah unload saat generasi berjalan;
- pemulihan ketika runtime berhenti saat chat;
- validasi event cleanup dan stream IDs;
- benchmark model target yang realistis.

Exit criteria:
- respons normal selalu berakhir tanpa error palsu;
- stream terputus sungguhan tetap dilaporkan;
- cancel tidak meninggalkan worker/registry;
- UI dan history stabil selama error runtime.

### Phase 5 — Update dan keamanan runtime

**Tujuan:** pembaruan runtime tidak merusak aplikasi atau model.

Pekerjaan:
- periksa versi target runtime yang telah diuji;
- verifikasi signature sumber/paket dan checksum yang tersedia;
- perencanaan migrasi/rollback;
- update runtime hanya saat operasi model/chat idle;
- pisahkan versi runtime dari versi aplikasi;
- log hasil update dan error.

Exit criteria:
- update tidak dijalankan diam-diam saat chat aktif;
- model tetap terdaftar setelah update;
- kegagalan tidak menghapus runtime lama tanpa recovery;
- versi yang tidak dikenal menghasilkan pesan aman.

### Phase 6 — QA, distribusi, dan dokumentasi

**Tujuan:** menyiapkan rilis stabil untuk pengguna Windows.

Pekerjaan:
- clean install, upgrade install, repair, dan uninstall test;
- pengujian komputer tanpa Ollama dan yang sudah memilikinya;
- pengujian model target di CPU dan GPU yang didukung;
- validasi proses, path, permission, log dan updater;
- dokumentasi troubleshooting;
- cek ukuran installer dan penggunaan disk;
- tinjau lisensi/attribution untuk seluruh artefak runtime.

Exit criteria:
- semua test kritis lulus pada Windows;
- model dan conversation data tetap aman;
- installer dan updater sesuai kebijakan signature;
- hasil uji tercatat pada PR sebelum release.

---

## 15. Matriks acceptance test

| ID | Skenario | Hasil yang diwajibkan |
|---|---|---|
| RT-01 | Mesin bersih tanpa runtime | AzaleaHouse menawarkan setup, tidak mengklaim runtime siap |
| RT-02 | Ollama sudah terpasang dan berjalan | Runtime terdeteksi, tidak membuat salinan kedua |
| RT-03 | Ollama terpasang tetapi berhenti | UI dapat menjalankan/memandu start sesuai strategi terpilih |
| RT-04 | Port 11434 digunakan proses lain | Tidak membunuh proses; diagnostik menjelaskan konflik |
| RT-05 | Internet offline saat runtime sudah siap | Chat model lokal tetap berjalan |
| RT-06 | Internet offline saat bootstrap diperlukan | Pesan offline dan retry; UI tidak freeze |
| RT-07 | Model target belum diunduh | UI meminta download dan tidak memulai chat |
| RT-08 | Download model dibatalkan | State bersih; model belum lengkap tidak dianggap siap |
| RT-09 | Disk penuh | Error jelas, file partial dibersihkan bila aman |
| RT-10 | Model dihapus | Hanya model terpilih terhapus setelah konfirmasi |
| RT-11 | Runtime berhenti saat chat | Error stream ditampilkan; history dipertahankan |
| RT-12 | Chat aktif saat Stop/Unload | Operasi ditolak atau menunggu dengan aturan eksplisit; tidak korup stream |
| RT-13 | App ditutup | Hanya proses yang owned dan sesuai kebijakan yang dihentikan |
| RT-14 | Runtime eksternal milik pengguna | Tidak dihentikan secara otomatis |
| RT-15 | Upgrade AzaleaHouse | Model dan history lama tetap terdeteksi |
| RT-16 | Update runtime gagal | Terdapat diagnosis/recovery tanpa menghapus model |
| RT-17 | Restart app setelah crash | Stale state dibersihkan, history tetap dapat dibuka |
| RT-18 | Sumber download/signature tidak valid | Paket ditolak |
| RT-19 | Stream NDJSON normal | Chunks muncul dan final marker dikenali |
| RT-20 | Stream putus sebelum final marker | Respons parsial ditandai tidak lengkap |

---

## 16. Risiko utama dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Distribusi runtime berubah | Verifikasi mekanisme distribusi pada Phase 0; pin versi yang diuji |
| Instalasi pengguna sudah memiliki Ollama | Deteksi existing runtime; jangan memaksa migrasi |
| Dua instance runtime | Supervisor idempotent dan pencatatan ownership |
| Model terunduh ulang | Bandingkan katalog aktual dan jangan pindahkan cache otomatis |
| Port ditempati proses asing | Validasi API, jangan membunuh proses yang tidak dimiliki |
| Model tidak kompatibel dengan hardware | Katalog kemampuan tervalidasi dan batas rekomendasi |
| Chat putus saat restart | Kunci lifecycle selama chat aktif dan laporkan partial response |
| Installer bermasalah atau unsigned | Validasi signature sumber dan aturan trust sebelum bootstrap |
| Update merusak runtime | Versi runtime yang diuji, maintenance window, serta recovery/rollback |
| Ukuran installer membesar | Jangan menyertakan bobot model; bandingkan opsi runtime bundled vs bootstrap |
| Perubahan fitur lintas file | Pertahankan kontrak Tauri dan lakukan migrasi dalam PR kecil per fase |

---

## 17. Metrik keberhasilan

Metrik harus diukur dalam acceptance test, bukan diklaim sebelum tes dilakukan.

- Persentase startup runtime yang sukses pada perangkat uji.
- Median dan p95 waktu dari launch app sampai runtime ready.
- Median waktu first-token untuk model dan konfigurasi hardware yang dicatat.
- Frekuensi false error pada streaming normal.
- Persentase download model yang selesai atau dapat dicoba ulang dengan state benar.
- Tidak ada kehilangan history pada runtime crash/restart.
- Tidak ada terminasi otomatis atas proses runtime eksternal.
- Installer size dan disk footprint yang terukur.
- Tidak ada request inferensi ke host cloud ketika menggunakan mode lokal.
- Semua command privileged memiliki validasi dan test.

---

## 18. Struktur kode sasaran

Struktur berikut adalah tujuan desain, bukan instruksi untuk membuat semua file sekaligus. Reuse file yang sudah ada jika tanggung jawabnya setara.

```text
src-tauri/src/
  ollama.rs              # Adapter API Ollama, diperkecil menjadi transport/model API
  runtime/
    mod.rs               # Kontrak status dan facade runtime
    supervisor.rs        # Start/stop/readiness/ownership
    bootstrap.rs         # Verifikasi dan setup runtime
    diagnostics.rs       # Error mapping dan diagnostic payload
  model_catalog.rs       # Katalog dan metadata kompatibilitas
  chat_stream.rs         # Parsing stream dan event chat jika layak dipisah

src/
  components/
    VersionCenter.tsx    # Tetap khusus versi aplikasi
    ...                  # AI Lokal / Settings menggunakan typed commands
```

Pembagian final harus mengikuti struktur repository yang aktual agar tidak membuat abstraksi berlebihan.

---

## 19. Rollout dan kompatibilitas

1. Jangan melakukan migrasi massal folder model pada update pertama.
2. Luncurkan supervisor secara bertahap dan tetap dukung existing Ollama.
3. Tambahkan status diagnostik sebelum mengaktifkan automasi start/stop yang agresif.
4. Catat versi runtime yang diuji pada setiap build yang dirilis.
5. Jangan rilis hanya karena frontend berhasil dibangun; wajib uji installer dan lifecycle pada Windows.
6. Jangan menghapus mekanisme lama sampai jalur baru telah lolos acceptance test.
7. Setiap fase implementasi dibuat menjadi PR terfokus dengan build/test result.
8. Update aplikasi dan runtime tetap memiliki versi, release notes, dan rollback policy terpisah.

---

## 20. Keputusan yang masih memerlukan hasil discovery

| Pertanyaan | Pilihan awal yang disarankan | Syarat sebelum dikunci |
|---|---|---|
| Runtime dibundel atau bootstrap? | Bootstrap/managed setup jika distribusi resmi mendukung dengan aman | Verifikasi distribusi, silent/per-user setup, signature dan lisensi |
| Runtime eksternal yang telah berjalan dipakai? | Ya, setelah health check; diberi label external | Test deteksi tanpa menghentikan proses user |
| Lokasi model | Pertahankan lokasi Ollama lama pada fase awal | Verifikasi lokasi aktual dan konfigurasi custom |
| Stop runtime saat app ditutup | Hanya runtime yang dimiliki app, sesuai kebijakan | Uji ownership dan proses child |
| Update runtime otomatis | Tidak pada fase awal | Butuh versi pin, signature, recovery dan acceptance test |
| Pengguna bisa memilih folder model? | Pertimbangkan setelah baseline | Uji konfigurasi runtime, ruang disk dan migrasi |
| Pindah ke llama.cpp? | Bukan bagian fase awal | Evaluasi sebagai inisiatif terpisah berdasarkan benchmark dan model target |

---

## 21. Definisi selesai untuk inisiatif ini

Inisiatif **Ollama dikelola oleh AzaleaHouse** dapat dinyatakan selesai hanya jika:

- pengguna dapat menyiapkan dan menggunakan runtime dari UI tanpa panduan terminal;
- lifecycle runtime dapat diprediksi dan tidak mengambil alih proses eksternal;
- model yang sudah ada tetap tersedia;
- pengunduhan, status, load/unload, serta recovery dapat dilakukan dari AzaleaHouse;
- chat streaming dan cancellation lulus test;
- inferensi tetap lokal;
- build installer, tes keamanan, dan tes Windows selesai;
- setiap keterbatasan serta strategi distribusi dijelaskan di release notes.

**Catatan final:** dokumen ini merupakan PRD/plan untuk implementasi bertahap. Dokumen ini tidak menyatakan Ollama sudah dibundel atau sudah dikelola otomatis dalam build saat ini. Perubahan produk harus dilakukan melalui PR dan acceptance test terpisah.
