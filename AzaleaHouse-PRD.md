# AzaleaHouse — Product Requirements Document (PRD)

**Dokumen sumber utama untuk implementasi AzaleaHouse**  
**Status:** Draft terstruktur untuk persiapan development  
**Versi dokumen:** 0.2.0  
**Tanggal:** 30 Oktober 2026  
**Target platform awal:** Windows desktop  
**Bahasa utama produk:** Bahasa Indonesia  
**Nama produk:** AzaleaHouse  
**Nama folder memori wajib:** `.AzaleaMemory`

> **Instruksi penting untuk AI coding agent:** Dokumen ini adalah sumber kebenaran produk. Jangan mengubah tujuan produk, nama, kebijakan privasi, perilaku update manual, atau skema penyimpanan tanpa persetujuan pengguna. Beberapa pilihan teknis masih berstatus kandidat dan harus divalidasi pada Phase 0 sebelum dikunci. Kerjakan satu fase/step pada satu waktu, jalankan tes dan laporkan hasilnya, lalu berhenti menunggu instruksi berikutnya.

---

## 1. Ringkasan Produk

AzaleaHouse adalah aplikasi AI assistant lokal untuk Windows yang membantu pengguna dalam pekerjaan sehari-hari: percakapan, penulisan, analisis dokumen, memahami gambar, pencarian informasi dalam file lokal, serta membuat dokumen DOCX/PDF dengan layout yang rapi.

Produk ini bukan sekadar UI chat yang membungkus model. AzaleaHouse terdiri dari beberapa subsistem yang terpisah dan dapat diuji sendiri:

1. **Desktop UI** untuk chat dan pengaturan.
2. **Chat engine** untuk streaming, konteks, riwayat, dan kontrol generasi.
3. **Runtime manager** untuk memuat model lokal, mempertahankan model tetap aktif, dan mengeluarkannya dari RAM.
4. **Model settings** untuk Thinking Mode, context window, output limit, dan parameter yang didukung model/runtime.
5. **Local memory/storage** yang dikelola melalui folder bernama `.AzaleaMemory`.
6. **File processing engine** yang membaca format file yang didukung.
7. **Vision pipeline** yang mengirim gambar ke model multimodal jika kompatibel.
8. **Document engine** untuk menghasilkan DOCX/PDF dengan struktur dan layout yang sebenarnya.
9. **Version Center & updater** yang mengambil informasi release dari GitHub, menampilkan catatan versi, serta menjalankan download dan pemasangan hanya setelah tindakan manual pengguna.
10. **Appearance engine** untuk panel glassmorphism dan background langit/awan animasi yang bisa dinonaktifkan.

Target pengalaman pengguna adalah aplikasi yang terasa premium, sederhana, responsif, transparan soal privasi, dan tidak membutuhkan layanan cloud untuk fungsi AI inti setelah model serta dependensi yang dibutuhkan sudah tersedia secara lokal.

## 2. Masalah yang Ingin Diselesaikan

- Chat AI biasa tidak otomatis menghasilkan file dokumen dengan tata letak profesional.
- Banyak aplikasi AI membutuhkan upload ke server eksternal, sedangkan pengguna menginginkan pemrosesan lokal untuk file dan percakapan.
- Konfigurasi model biasanya tersembunyi atau harus disunting lewat file konfigurasi; AzaleaHouse perlu menyediakan kontrol yang dapat dipahami dari UI.
- Model lokal dapat terasa lambat jika terus-menerus dimuat ulang, konteks terlalu besar, atau jawaban terlalu panjang.
- Pengguna membutuhkan riwayat percakapan dan memori yang tidak disimpan sembarangan.
- Update aplikasi harus mudah ditemukan, tetapi download dan pemasangan versi baru harus tetap berada dalam kendali pengguna.

## 3. Tujuan Produk

### 3.1 Tujuan inti

- Menyediakan AI assistant lokal yang dapat dipakai untuk pekerjaan umum.
- Menampilkan respons secara streaming agar pengguna segera melihat teks mulai muncul.
- Mendukung kontrol Thinking Mode ON/OFF sesuai preferensi pengguna dan kemampuan runtime.
- Menyediakan pengaturan manual untuk context window, batas output, serta parameter model yang kompatibel.
- Mengelola runtime dengan kebijakan keep-alive satu jam atau mode manual.
- Menyimpan data aplikasi secara lokal di tempat yang jelas, dengan `.AzaleaMemory` sebagai direktori khusus data percakapan/memori.
- Mendukung file dan gambar melalui pipeline khusus, bukan menaruh semua konten ke prompt tanpa pengolahan.
- Membuat dokumen DOCX/PDF melalui document engine terpisah.
- Menyediakan Version Center di pojok kiri bawah UI dan proses update berbasis GitHub Release.
- Tidak mengunduh atau memasang update aplikasi secara otomatis. Pengguna harus memulai tindakan update secara manual.

### 3.2 Bukan tujuan awal

- Melatih model dasar dari nol.
- Menjadi pengganti penuh Microsoft Word atau Excel.
- Mendukung setiap format file yang pernah dibuat; dukungan harus bertahap dan dinyatakan secara eksplisit.
- Menjalankan seluruh percakapan melalui layanan cloud.
- Membundel file bobot model besar ke installer awal secara default.
- Menjalankan arbitrary shell command atau mengeksekusi macro dari dokumen yang diunggah.
- Menjalankan automatic download/install aplikasi baru tanpa persetujuan pengguna.
- Menggabungkan produk ini dengan proyek teman bercerita **PULANG**. PULANG adalah produk berbeda dan berada di luar scope dokumen ini.

## 4. Target Pengguna dan Skenario

Target pertama adalah pengguna Windows yang ingin menjalankan AI di laptopnya sendiri, termasuk pengguna non-ahli yang tidak ingin mengatur model melalui terminal setiap kali.

### Skenario prioritas

1. Pengguna membuka AzaleaHouse dan memulai chat baru.
2. Pengguna bertanya dalam bahasa Indonesia dan melihat respons mulai muncul tanpa menunggu seluruh jawaban selesai.
3. Pengguna mengaktifkan Thinking untuk tugas yang kompleks atau mematikannya untuk respons sederhana.
4. Pengguna memilih context window dan batas output secara manual.
5. Pengguna mengunggah PDF dan meminta ringkasan atau jawaban berdasarkan isinya.
6. Pengguna mengirim gambar/screenshot untuk dianalisis.
7. Pengguna meminta laporan dan mengunduh DOCX/PDF yang tertata.
8. Pengguna menutup aplikasi dan membuka kembali percakapan lama.
9. Model tetap di RAM selama satu jam setelah aktivitas terakhir di mode otomatis, atau tetap aktif sampai dimatikan dalam mode manual.
10. Aplikasi mendeteksi release terbaru, menampilkan Version Center, tetapi tidak mengunduh atau memasang update sebelum pengguna mengklik aksi terkait.
11. Pengguna membuka `.AzaleaMemory`, mengganti lokasinya, mencadangkan, memulihkan, atau menghapus data melalui Settings.

## 5. Keputusan Produk yang Sudah Ditetapkan

| Area | Keputusan |
|---|---|
| Nama produk | AzaleaHouse |
| Tipe produk | Aplikasi desktop Windows, dipaketkan sebagai installer `.exe` |
| Arah UI | Minimal, premium, profesional, glassmorphism |
| Background | Langit/awan senja; ada animasi ringan dan opsi OFF/reduced motion |
| Model kandidat | Gemma 4 E2B multimodal; wajib divalidasi sebelum menjadi dependency tetap |
| Runtime kandidat | Ollama; wajib diuji kompatibilitas Thinking, streaming, keep-alive, dan vision |
| Thinking Mode | Pengguna dapat mengaktifkan/menonaktifkan; preferensi default dan override per pesan |
| Context | Pengaturan manual + validasi terhadap kemampuan model/runtime |
| Quick response | Profil respons sederhana yang menghindari tool/penalaran tambahan jika tidak diperlukan |
| Keep-alive default | 1 jam setelah aktivitas model terakhir |
| Runtime manual | Mode alternatif yang mempertahankan model sampai dimatikan pengguna, jika runtime mendukungnya |
| Matikan model | Tombol manual untuk unload model tanpa menghapus chat/memory |
| Memory folder | `.AzaleaMemory` |
| Default storage location | `%LOCALAPPDATA%\AzaleaHouse\.AzaleaMemory\` per profil Windows |
| Custom memory path | Bisa dipilih dari Settings dan harus dimigrasikan dengan aman |
| Update app | Berbasis GitHub Release dan signed updater artifacts |
| Update download/install | Selalu manual; tidak boleh auto-download/auto-install |
| Version Center | Versi dapat diklik di pojok kiri bawah; menampilkan versi, detail, changelog, dan tindakan update |
| Coding workflow | Implementasi satu fase/step, tes, lalu stop untuk review pengguna |

## 6. Stack dan Batasan Arsitektur

### 6.1 Kandidat stack

- **Desktop shell:** Tauri 2.
- **Frontend:** React + TypeScript + Vite.
- **Native/backend layer:** Rust.
- **Local model runtime:** Ollama pada tahap validasi awal.
- **Model awal:** Gemma 4 E2B multimodal, jika terbukti berjalan baik pada runtime yang dipilih.
- **Local database:** SQLite untuk metadata/riwayat terstruktur jika terbukti paling sesuai; file konfigurasi sederhana untuk preferensi ringan.
- **DOCX generation:** Python `python-docx` atau alternatif teruji; integrasi runtime-nya harus dipilih pada Architecture phase.
- **PDF:** library PDF yang sesuai atau konversi dokumen melalui renderer yang dapat dikontrol; hasil wajib divalidasi.
- **Updater:** plugin updater resmi Tauri 2 dengan signature verification, menggunakan static update manifest/release assets dari GitHub Releases.
- **Installer:** NSIS setup executable sebagai kandidat utama.

### 6.2 Status keputusan teknis

Stack di atas adalah rekomendasi produk, tetapi kompatibilitas wajib diverifikasi. Agent dilarang menganggap package name, App ID, URL GitHub, versi dependency, dan parameter model sudah final jika belum dikonfirmasi. Simpan keputusan yang sudah diuji di `docs/DECISIONS.md`.

### 6.3 Prinsip arsitektur

- UI tidak boleh memanggil OS, filesystem, atau proses lokal lewat API web arbitrary.
- Semua operasi privileged melewati command API Rust/Tauri yang dibatasi.
- Backend tidak boleh menerima arbitrary command string lalu menjalankannya sebagai shell.
- Runtime manager harus memiliki status eksplisit, timeout, error mapping, dan penanganan model yang belum terpasang.
- File processing dibuat modular per tipe file.
- AI tidak boleh menjadi satu-satunya komponen untuk menghasilkan layout dokumen.
- Application updater harus memverifikasi signed artifacts; jangan memasang binary release yang tidak diverifikasi.
- Jalur memory utama dan custom path harus dikonfigurasi secara eksplisit; jangan menyebar data pengguna ke folder acak.

## 7. UI/UX Requirements

### 7.1 Gaya visual

- Minimal, premium, profesional, nyaman dibaca.
- Glassmorphism: permukaan transparan, backdrop blur, garis tepi tipis, radius konsisten.
- Palet mengambil warna dari langit: deep blue, lavender, violet, peach, dan warna teks kontras.
- Background langit/awan adalah gambar aset terpisah dari komponen UI.
- Panel glass harus tetap dapat dibaca saat area belakang sangat terang; gunakan tint/translucency dan overlay adaptif.
- Jangan menggunakan efek neon berlebihan, border berwarna kuat, atau animasi cepat.
- Animasi background dapat dinonaktifkan; saat OFF, gunakan gambar statis yang sama.

### 7.2 Layout desktop

**Sidebar kiri**
- Identitas AzaleaHouse/logo.
- Tombol Chat Baru.
- Navigasi: Chat, Dokumen, Gambar, Riwayat, Pengaturan.
- Status model/runtime dan penggunaan RAM jika metrik dapat diperoleh dengan aman.
- Version indicator di pojok kiri bawah, dapat diklik.

**Area chat tengah**
- Empty state berisi nama AzaleaHouse, tagline singkat, dan prompt saran.
- Daftar pesan yang dapat discroll.
- Render markdown yang benar, code fences, tabel, list, dan link.
- Aksi pesan: copy, regenerate bila didukung, dan feedback error.
- Streaming token, status thinking, status tool/file processing, stop generation.
- Composer tetap mudah ditemukan di bagian bawah tanpa menutupi pesan.

**Message composer**
- Text input multi-line.
- Send button.
- Attachment button untuk file yang didukung.
- Toggle Thinking.
- Quick context selector atau akses cepat ke context settings.
- Indikator model bila model belum siap, sedang memuat, sedang menghasilkan, atau error.
- Enter mengirim; Shift+Enter membuat baris baru. Perilaku harus konsisten dan dapat dikonfigurasi bila diperlukan.

**Panel pengaturan AI kanan**
- Bisa dibuka/ditutup.
- Menampilkan Thinking, model, runtime policy, context window, output limit, dan shortcut ke pengaturan lanjutan.
- Panel tertutup ketika tidak dibutuhkan, agar area percakapan tetap luas.

### 7.3 Appearance settings

- Background animation ON/OFF.
- Reduced motion.
- Intensitas blur bila feasible.
- Preferensi warna/kontras atau light/dark treatment jika masuk akal dengan palet background.
- Jika animasi OFF, aplikasi tidak boleh terus menjalankan loop animasi yang tidak terlihat.

### 7.4 Accessibility dan performa UI

- Teks utama dan pesan harus terbaca di atas background.
- Kontrol punya label yang jelas, focus ring keyboard, dan status disabled yang mudah dikenali.
- Hormati Windows reduced-motion preference jika tersedia.
- Gunakan transform/opacity untuk animasi; hindari animasi layout mahal.
- Sediakan opsi mematikan background animation untuk perangkat lambat.

## 8. Chat Engine dan Respons Cepat

### 8.1 Streaming

- Gunakan streaming bila API/runtime mendukungnya.
- Token/chunk harus ditampilkan secara incremental.
- UI harus punya state: idle, preparing, loading model, thinking, generating, finishing, error, cancelled.
- Jika streaming terputus, tampilkan pesan error yang dapat dipahami dan pertahankan input pengguna.

### 8.2 Profil respons

**Quick Chat**
- Untuk fakta sederhana, terjemahan, definisi, dan revisi singkat.
- Prompt/instruksi sesingkat yang tetap cukup.
- Thinking OFF sebagai default profil jika didukung runtime.
- Output limit relatif rendah, default baseline 384 token, dapat disesuaikan pengguna.
- Tidak memanggil tool yang tidak dibutuhkan.

**Balanced**
- Profil umum untuk percakapan dan penulisan sehari-hari.
- Parameter mengikuti nilai rekomendasi model yang sudah diuji.

**Deep Analysis**
- Untuk analisis berlapis dan tugas kompleks.
- Mengaktifkan Thinking jika runtime/model mendukungnya.
- Batas output dan konteks lebih besar, tetap dalam batas yang ditentukan pengguna dan perangkat.

Profil adalah preset aplikasi, bukan model terpisah. Pengguna dapat memilih preset lalu mengubah parameter lanjutan.

### 8.3 Thinking Mode

- Toggle dapat diubah sebelum setiap pesan.
- Ada preferensi default di Settings.
- Status Thinking yang dikirim ke runtime harus benar-benar sesuai toggle; jangan hanya mengganti label UI.
- Jika model/runtime tidak mendukung kontrol thinking, kontrol harus ditandai unsupported/nonaktif dan menjelaskan alasannya; jangan pura-pura menerapkan.
- Saat aktif, UI boleh menunjukkan status “Sedang berpikir…” atau indikator yang setara.
- Tampilkan jawaban akhir sebagai default. Jangan otomatis menggabungkan trace internal thinking mentah ke chat history atau mengirimkannya sebagai konteks turn berikutnya. Jika runtime memisahkan field thinking, tangani sesuai format resmi model dan kebijakan tampilan yang ditentukan.
- Simpan status thinking sebagai metadata pesan agar histori jelas.

### 8.4 Parameter model

Basic settings:
- Model yang tersedia/terpasang.
- Thinking.
- Context window.
- Maximum output tokens.
- Temperature.

Advanced settings jika didukung:
- Top-p.
- Top-k.
- Seed.
- Repeat penalty.
- Stop sequences.
- Parameter inference lain sesuai runtime.

Aturan:
- Validasi min/max dan dukungan parameter oleh runtime/model.
- Jangan kirim parameter yang tidak didukung secara diam-diam.
- Tampilkan default yang benar-benar dipakai.
- Context default 4096 token adalah baseline benchmark, bukan angka yang harus dipaksakan pada setiap model.
- Output default 384 token untuk Quick Chat adalah baseline, bukan batas global untuk pembuatan dokumen panjang.
- Jangan memperbesar context tanpa mempertimbangkan RAM/latensi.

### 8.5 Context manager

Context window bukan memori jangka panjang.

Sebelum request dibuat, context manager menentukan:
1. System prompt dan instruksi perilaku.
2. Model/runtime metadata dan parameter permintaan.
3. Pesan terbaru yang relevan.
4. Ringkasan turn lama jika diperlukan.
5. Potongan memory yang disetujui dan relevan.
6. Potongan dokumen relevan, tidak otomatis seluruh dokumen.
7. Pesan pengguna terbaru.

Context manager harus menjaga token budget; memprioritaskan pesan terbaru dan informasi yang relevan; menandai jika konten lama diringkas atau tidak disertakan. Jangan diam-diam menghapus fakta penting tanpa summary atau indikator.

## 9. Runtime Manager

### 9.1 Status runtime/model

Status minimal:
- `not_installed`
- `runtime_unavailable`
- `model_not_downloaded`
- `unloaded`
- `loading`
- `ready`
- `thinking`
- `generating`
- `unloading`
- `error`

UI harus membedakan proses service/runtime dari status model yang berada di RAM.

### 9.2 Keep-alive default 1 jam

Mode Automatic:
- Set model keep-alive ke 1 jam bila API runtime mendukung.
- Perhitungan waktu harus merujuk aktivitas model/generasi terakhir.
- Request baru mengatur ulang timer keep-alive.
- Jangan unload model ketika generasi sedang berlangsung.
- Jika timer selesai ketika model masih busy, tandai unload pending dan lepaskan sesudah pekerjaan selesai, kecuali pengguna memilih matikan segera dan membatalkan generasi.
- Saat aplikasi restart, jangan otomatis menjamin model sudah dimuat; periksa status runtime.

Mode Manual:
- Model tetap loaded selama runtime mendukung kebijakan keep-alive tanpa batas atau setara.
- Tidak ada auto-unload hanya karena timer satu jam selesai.
- Model dapat dihentikan lewat tombol `Matikan Model Sekarang`.

Manual shutdown:
- Ketika model sedang idle, keluarkan dari memori.
- Jika model sedang generating, minta konfirmasi: berhenti dan matikan, atau tunggu sampai selesai.
- Riwayat chat, `.AzaleaMemory`, settings dan attachments tidak boleh dihapus oleh aksi ini.

### 9.3 Error handling runtime

- Jika runtime tidak terpasang/tidak berjalan, tampilkan panduan yang dapat ditindaklanjuti.
- Jika model belum ada, tawarkan tombol download model; tampilkan ukuran/progress jika tersedia.
- Jangan hang UI ketika runtime request tidak merespons; gunakan timeout dan cancel.
- Jangan men-download model berulang tanpa persetujuan.
- Jika Ollama dipakai aplikasi lain, jangan menghentikan service secara global saat hanya ingin unload model AzaleaHouse.

## 10. Local Data, Profile, dan `.AzaleaMemory`

### 10.1 Lokasi default

```text
%LOCALAPPDATA%\AzaleaHouse\.AzaleaMemory\
```

Folder ada di profil Windows pengguna aktif. Pengguna tidak wajib mengatur path saat pertama kali menjalankan aplikasi. Jangan menyimpan data user pada working directory aplikasi, folder sementara, atau path hardcoded yang berbeda antar mesin.

### 10.2 Struktur konseptual

```text
.AzaleaMemory/
├── profile/
├── memories/
├── conversations/
├── indexes/
├── attachments/
├── backups/
├── cache/
└── metadata/
```

Agent boleh memilih apakah bagian tertentu direalisasikan sebagai direktori, database lokal, atau file metadata berdasarkan kebutuhan teknis; nama root `.AzaleaMemory` dan pemisahan tanggung jawabnya harus tetap dipertahankan. Hindari membuat banyak file kecil jika database lokal lebih robust.

### 10.3 Pemisahan data

- `profile`: preferensi pengguna dan metadata profil aplikasi.
- `memories`: memori jangka panjang yang explicitly disetujui atau dipilih pengguna.
- `conversations`: sesi chat, pesan, timestamp, dan metadata model/parameter.
- `indexes`: indeks pencarian lokal. Indeks dapat dibangun ulang dari sumbernya.
- `attachments`: salinan file yang memang diputuskan untuk disimpan oleh aplikasi; perilaku copy/reference harus jelas dan terlihat di UI.
- `backups`: snapshot backup yang dikelola aplikasi.
- `cache`: data temporary yang boleh dibersihkan bila aman.
- `metadata`: schema version, migration state, dan informasi integritas.

### 10.4 Memory versus history

- Conversation history bukan otomatis personal memory.
- Memori permanen harus dapat dilihat, diedit, dihapus, atau dinonaktifkan.
- User harus dapat mengetahui kapan informasi disimpan sebagai memory.
- Jangan menyimpulkan atau menyimpan label sensitif tentang psikologi, kesehatan, atau identitas pengguna tanpa persetujuan yang jelas.
- Memory retrieval harus relevan dengan chat dan dibatasi token budget.

### 10.5 Custom location

Settings menyediakan:
- Display current path.
- Open folder.
- Select new folder via native directory picker.
- Migrate data.
- Verify destination and free space.
- Create backup before migration.
- Copy/migrate and validate database/files before switching active path.
- Roll back to old path if migration fails.
- Do not delete original data automatically until user confirms and new location has passed validation.

Jika path kustom tidak tersedia atau drive dilepas, tampilkan error dan jangan membuat folder pengganti diam-diam di lokasi lain. Tawarkan fallback eksplisit ke path default hanya dengan persetujuan pengguna.

### 10.6 Backup, restore, delete

- Backup dibuat ke lokasi yang dipilih pengguna atau folder backup default.
- Restore melakukan schema/version validation dan preview isi sebelum menimpa data aktif.
- Delete memory terpisah dari delete conversation history dan cache.
- Sediakan konfirmasi untuk operasi destruktif.
- Uninstall normal tidak boleh secara diam-diam menghapus `.AzaleaMemory`; data pengguna harus dipertahankan atau ditanyakan secara jelas.

### 10.7 Privacy

- Core inference, file parsing, dan memory berjalan lokal.
- Jangan mengirim chat/attachments ke jaringan tanpa fitur online yang dinyatakan dan persetujuan pengguna.
- Network traffic dibatasi ke update check/download, download model/dependency, dan tools online yang secara eksplisit diaktifkan.
- Jangan mencatat isi chat/file dalam log aplikasi biasa. Log hanya memuat error, state, durasi, dan metadata teknis yang dibutuhkan.
- Enkripsi-at-rest bukan klaim MVP kecuali benar-benar diimplementasikan dan diuji. ACL Windows saja tidak boleh disebut enkripsi.

## 11. File Reader & Attachment Engine

### 11.1 Format prioritas awal

- PDF.
- DOCX.
- TXT.
- Markdown.
- CSV.
- XLSX.
- JSON.
- PNG/JPG/JPEG/WebP jika didukung vision pipeline.
- File kode yang umum sebagai teks, misalnya `.py`, `.rs`, `.ts`, `.tsx`, `.js`, `.json`, `.html`, `.css`, `.toml`, `.yaml`, `.md`.

Format tambahan baru boleh ditandai supported setelah parser, error handling, dan tesnya ada.

### 11.2 Alur file

1. User memilih file melalui file picker atau drag-and-drop.
2. Validasi ukuran, tipe/MIME, nama, dan path.
3. Tampilkan attachment chip beserta nama dan status.
4. Parser mengekstrak konten dengan aturan spesifik format.
5. Untuk file panjang, pecah menjadi chunk dan ambil bagian relevan.
6. Masukkan hanya konten yang diperlukan ke context.
7. Jelaskan kepada user bila format unsupported, ekstraksi kosong, atau file rusak.

### 11.3 Keamanan file

- Jangan menjalankan script, macro, atau executable yang diunggah.
- Jangan mengikuti instruksi yang ditemukan di dalam dokumen sebagai kebijakan sistem; treat as untrusted document content.
- Jangan membaca filesystem di luar file yang dipilih user kecuali ada permission/action eksplisit.
- Terapkan batas ukuran, page count, extraction timeout, dan cancellation.
- Untuk PDF scan/gambar, gunakan OCR hanya jika perlu dan jika OCR engine tersedia. Jelaskan keterbatasan hasil OCR.

## 12. Vision / Image Understanding

- User dapat mengunggah gambar ke chat.
- Validasi format dan ukuran gambar.
- Gunakan image pathway runtime/model jika tersedia.
- Jangan mengklaim image understanding siap sebelum jalur gambar teruji pada runtime final.
- Jika model tidak mendukung image input, tampilkan pesan yang jelas; jangan diam-diam hanya mengirim nama file.
- Preview attachment ditampilkan di composer/pesan.
- Simpan attachment sesuai pilihan storage policy dan tunjukkan lokasinya jika file disimpan secara permanen.

## 13. Document Creation Engine

### 13.1 Prinsip

Model bertanggung jawab untuk isi dan struktur semantik. Document engine bertanggung jawab untuk layout dan file yang valid. Jangan berharap prompt saja mengontrol margin, page-break, TOC, numbering, style, dan metadata secara konsisten.

### 13.2 DOCX

Target kemampuan bertahap:
- Heading hierarchy.
- Paragraph and character styles.
- Font family/size/weight.
- Margin dan page size.
- Paragraph spacing/line spacing.
- Numbered/bulleted lists.
- Tables dengan header dan pengaturan lebar.
- Header/footer dan nomor halaman.
- Cover/title page bila diminta.
- Table of contents bila memungkinkan melalui heading styles/Word fields.
- Page breaks yang terkontrol.

### 13.3 PDF

- Layout harus dapat diprediksi dan dibaca.
- Pastikan font/Unicode Indonesia tampil benar.
- Validasi pagination, margin, table wrapping, dan karakter yang hilang.
- Jika PDF dibuat dari DOCX menggunakan renderer eksternal, periksa ketersediaan dan lisensi dependensi.

### 13.4 Alur generasi

`User request -> AI content/structured outline -> document schema -> DOCX/PDF renderer -> output file -> optional render validation -> show save/open action`.

Output file tidak boleh hanya berupa file kosong atau ekstensi palsu. Validasi signature/file openability sebelum menyatakan sukses.

## 14. Skills, Tools, dan Web

Skill/tool dianggap modul orkestrasi, bukan mekanisme untuk mempercepat token generation secara langsung.

Modul rencana:
- Quick Response.
- File Analysis.
- Document Creation.
- Image Understanding.
- Local Knowledge Retrieval (tahap lanjutan).
- Summarization.
- Code/text analysis.
- Optional Web Research, OFF atau tidak tersedia secara default sampai desain privasi dan consent ditetapkan.

Tool hanya dipanggil sesuai kebutuhan. Prompt injection dari dokumen atau website tidak boleh menggantikan system/developer instructions.

## 15. Update System & Version Center — Manual Update Required

### 15.1 Keputusan inti

**Tidak ada auto-download atau auto-install.** Aplikasi boleh melakukan pemeriksaan metadata versi secara otomatis bila setting mengizinkan, tetapi tidak boleh mengunduh paket update, memasang update, atau me-restart aplikasi tanpa aksi eksplisit pengguna.

Default yang direkomendasikan:
- `Check for updates on launch`: ON, hanya memeriksa metadata ringan.
- `Automatically download updates`: OFF dan tidak boleh diaktifkan diam-diam.
- `Automatically install/restart`: OFF dan tidak tersedia sebagai perilaku default.
- Tombol `Check for Updates` selalu tersedia di Version Center.
- Jika tersedia versi baru, tampilkan indikator/notification non-blocking. Pengguna harus menekan `Download Update` untuk memulai download.
- Setelah download selesai, pengguna menekan `Install & Restart` untuk memasang update. Jika instalasi updater membutuhkan app exit, beri tahu pengguna sebelum menjalankannya.

### 15.2 Release source

- GitHub Releases menjadi sumber release publik aplikasi.
- GitHub Actions membangun artifact Windows ketika release version/tag resmi dibuat.
- Pushing code ke branch biasa saja tidak berarti release production otomatis diterbitkan.
- Gunakan version tag Semantic Versioning, contoh `v0.1.0`, `v0.2.0`, `v0.2.1`.
- Release berisi installer biasa, artifact updater yang cocok dengan Tauri updater, signature, dan release notes/manifest yang diperlukan.
- Nama owner/repository/endpoint tetap placeholder sampai ditetapkan; jangan mengarang URL GitHub.

### 15.3 Signature dan security

- Gunakan updater plugin resmi Tauri 2 dan signed artifacts.
- Public key disimpan di konfigurasi aplikasi.
- Private signing key disimpan dalam GitHub Actions Secrets atau secret manager aman; jangan commit ke repository, upload ke release, atau masukkan ke ZIP proyek.
- App harus menolak signature invalid atau artifact yang tidak cocok.
- Jangan menjalankan installer dari URL arbitrary tanpa signature verification.
- Update harus menggunakan HTTPS.

### 15.4 Version Center UI

Lokasi: pojok kiri bawah sidebar, menampilkan `AzaleaHouse vX.Y.Z`. Elemen dapat diklik untuk membuka modal/panel `Version Center`.

Isi Version Center:
- Installed version.
- Latest available version, jika berhasil diperiksa.
- Update status: up to date / update available / checking / offline / error / downloading / downloaded / installing.
- Release date.
- Deskripsi versi dan daftar perubahan dari GitHub Release notes.
- Tombol `Check for Updates`.
- Tombol `Download Update` jika versi tersedia.
- Tombol `Cancel Download` saat download berlangsung jika aman didukung.
- Progress bar.
- Persentase download.
- Jumlah downloaded/total bytes bila server menyediakan total size.
- Kecepatan download, misalnya MB/s, dihitung dari perubahan byte terhadap waktu.
- Estimasi waktu tersisa hanya jika memiliki dasar data yang memadai; jika tidak, sembunyikan.
- Tombol `Install & Restart` setelah download serta verifikasi sukses.
- Riwayat versi/release notes.

### 15.5 Flow update

1. Pemeriksaan metadata dilakukan saat startup (jika enabled) atau saat user menekan `Check for Updates`.
2. Jika tidak ada versi baru, tampilkan status `AzaleaHouse sudah menggunakan versi terbaru`.
3. Jika versi baru ada, tampilkan versi terkini, versi tersedia, tanggal, dan ringkasan changelog.
4. Tidak ada download dimulai sampai user menekan `Download Update`.
5. Tampilkan progress bar real-time, persen, bytes, dan speed.
6. Jika gagal, pertahankan aplikasi tetap dapat digunakan; tampilkan alasan yang masuk akal dan tombol Retry.
7. Setelah download selesai, verifikasi signature/artifact sebelum menawarkan instalasi.
8. User menekan `Install & Restart`; baru jalankan instalasi dan restart yang diperlukan.
9. Jika user memilih `Later`, paket yang telah diunduh boleh disimpan sebagai pending update dengan status yang jelas, atau dibersihkan menurut kebijakan yang ditetapkan; jangan memasang otomatis di belakang layar.
10. Setelah restart, verifikasi current version. Jika versi tetap sama, tampilkan update failure dan instruksi pemulihan.

### 15.6 Download progress dan speed

- Progress diukur dari byte yang benar-benar diterima, bukan timer animasi.
- Gunakan event download dari updater API yang didukung.
- Kecepatan dihitung dari delta bytes dalam sliding window waktu pendek yang stabil, ditampilkan dengan unit KB/s atau MB/s.
- Jika ukuran total tidak diketahui, tampilkan indeterminate progress dan speed; jangan menciptakan persentase palsu.
- Jangan menampilkan speed negatif/NaN; saat jaringan idle, boleh menunjukkan `0 KB/s` atau `Menunggu data...`.
- Tombol cancel menghentikan request jika API/implementasi dapat membatalkan dengan aman dan membersihkan partial artifact.

### 15.7 Notifikasi update

- Hindari spam notifikasi.
- Satu status update aktif pada satu waktu.
- Notifikasi tidak boleh menutupi chat atau memaksa update.
- Klik notifikasi membuka Version Center.
- Penutupan notifikasi tidak menghapus informasi bahwa update tersedia; Version Center tetap dapat dibuka melalui nomor versi.

### 15.8 GitHub Actions

Pipeline release yang direkomendasikan:
1. Agent/developer membuat perubahan dan test.
2. Pull Request melewati build/test CI.
3. Merge ke branch utama.
4. Developer membuat/tag release `vX.Y.Z`.
5. Workflow release membangun Windows installer dan updater artifacts.
6. Workflow menandatangani update memakai secret key.
7. Workflow membuat GitHub Release beserta notes dan manifest sesuai format Tauri updater.
8. Client memeriksa endpoint release dan menemukan versi baru.

Tidak boleh mem-publish production update pada setiap commit tanpa version bump, test, dan release tag yang jelas.

### 15.9 Error handling update

Tangani minimal:
- Offline atau DNS gagal.
- GitHub rate limit atau HTTP error.
- Release metadata tidak valid.
- Version string bukan SemVer.
- Asset/manifest tidak ditemukan (404).
- Signature invalid.
- Download interrupted.
- Insufficient disk space.
- Install failed.
- User cancels.
- Version setelah restart tidak berubah.

Pesan error harus mencakup langkah yang bisa dilakukan. Update failure tidak boleh merusak local memory atau conversation database.

## 16. Versioning & Project Release Discipline

- Gunakan Semantic Versioning.
- Satu sumber kebenaran untuk versi (misalnya package/version configuration yang kemudian diselaraskan ke Tauri build). Detail mekanisme dipastikan pada Architecture phase.
- Versi UI, installer, release tag, update metadata, dan About/Version Center harus konsisten.
- Perubahan bug fix menaikkan patch; fitur kompatibel minor; breaking change major, menurut kebijakan release.
- Release notes dibuat untuk setiap release dan menjelaskan fitur, perbaikan, known issue, serta migrasi data bila ada.

## 17. Non-Functional Requirements

### Performa
- Streaming first token lebih diutamakan daripada menunggu seluruh output.
- Ukur `time_to_first_token`, tokens/sec jika runtime menyediakan, load time, RAM idle/active, dan CPU/GPU use bila dapat diperoleh.
- Background animation tidak boleh menghambat input/scroll/chat.
- File parser harus asynchronous dan cancellable agar tidak membekukan UI.

### Reliabilitas
- Aplikasi tidak crash ketika runtime offline atau model belum tersedia.
- Chat dan settings dipersistensikan secara aman.
- Migrasi data harus memiliki backup/rollback.
- Update failure tidak boleh menghapus data user.
- Write data/database harus tahan terhadap aplikasi tertutup mendadak semampunya.

### Privasi dan keamanan
- Data chat dan memory tidak terkirim keluar secara default.
- Update security menggunakan signature verification.
- Private key tidak masuk source code.
- Attachments tidak dieksekusi.
- Validasi path/size/type dan cegah path traversal.
- Tidak meminta Administrator privileges kecuali benar-benar diperlukan.

### Maintainability
- UI, runtime, memory, file processing, document rendering, dan updater dibuat sebagai modul yang terpisah.
- Error mempunyai kode/kategori yang jelas.
- Settings schema berversi dan dapat dimigrasikan.
- Feature flags boleh dipakai selama development; tidak boleh menjadi backdoor di production.

## 18. Acceptance Criteria MVP

MVP dinyatakan lulus hanya jika kriteria yang relevan berikut dapat diuji:

### Aplikasi dan UI
- [ ] Dapat dijalankan sebagai aplikasi Windows.
- [ ] Sidebar, area chat, composer, settings panel, dan Version Center tampil benar.
- [ ] Background dan glass effect bekerja; animasi bisa OFF.
- [ ] Input/scroll/chat tidak freeze saat animasi berjalan.

### Runtime dan chat
- [ ] Aplikasi mendeteksi runtime tidak tersedia dan memberikan error yang actionable.
- [ ] Chat lokal menghasilkan jawaban dengan streaming.
- [ ] Thinking ON/OFF benar-benar diteruskan atau dipetakan ke runtime.
- [ ] Parameter context/output disimpan dan diterapkan.
- [ ] Quick Chat tidak memanggil tool yang tidak dibutuhkan.
- [ ] Pengguna dapat membatalkan generasi sesuai kemampuan API.

### Runtime lifecycle
- [ ] Automatic mode unload setelah satu jam idle menurut definisi timer yang ditetapkan.
- [ ] Permintaan baru mereset timer.
- [ ] Model tidak dihentikan di tengah generasi tanpa keputusan user.
- [ ] Manual mode tidak auto-unload berdasarkan timer.
- [ ] `Matikan Model Sekarang` unload model tetapi mempertahankan chat/data.

### Memory/data
- [ ] Root `.AzaleaMemory` dibuat di path default untuk user Windows.
- [ ] Percakapan bertahan setelah aplikasi restart.
- [ ] User dapat melihat lokasi dan membuka folder.
- [ ] Custom path bisa dipilih, divalidasi, dimigrasi, dan rollback bila gagal.
- [ ] Memory jangka panjang dipisahkan dari conversation history.
- [ ] Backup/restore/delete meminta konfirmasi sesuai tindakan.

### File/vision/document
- [ ] Semua format yang diberi label supported memiliki parser dan test.
- [ ] File rusak/unsupported menghasilkan error jelas.
- [ ] Image pathway diuji dengan model/runtime final.
- [ ] DOCX/PDF yang dibuat dapat dibuka dan layout diuji.
- [ ] Tidak ada file/macros/executable yang berjalan otomatis.

### Update system
- [ ] Client dapat check release metadata.
- [ ] Tidak ada automatic download/install.
- [ ] Update tersedia tampil di Version Center.
- [ ] Klik `Download Update` memulai download.
- [ ] Progress bar dan kecepatan download tampil berdasarkan data aktual.
- [ ] User dapat memilih `Install & Restart` secara eksplisit.
- [ ] Signature invalid ditolak.
- [ ] Update error dapat dipulihkan tanpa menghapus memory/chat.
- [ ] Versi di UI, installer, dan release metadata cocok.

## 19. Test Matrix Awal

| Area | Skenario |
|---|---|
| Runtime | Runtime tidak ada, runtime running, model belum download, model unloaded, load failure |
| Chat | Prompt pendek, prompt panjang, stream selesai, cancel, network/model error |
| Thinking | ON, OFF, model unsupported, riwayat setelah thinking |
| Context | Konteks default, nilai yang lebih besar, nilai di luar batas, chat sangat panjang |
| Keep-alive | Aktivitas berulang, timeout 1 jam, manual mode, shutdown ketika model busy |
| Storage | First run, restart, custom path, folder tak tersedia, disk penuh, migration failure, backup restore |
| Files | PDF teks, PDF scan, DOCX, XLSX, CSV, file corrupt, format unsupported, file besar |
| Documents | DOCX openability, PDF render, daftar isi, nomor halaman, tabel panjang, Unicode Indonesia |
| Background | Animation on/off, reduced motion, window resize, low performance mode |
| Updater | No update, update available, progress, speed display, cancellation, offline, 404, rate limit, invalid signature, install failure |

## 20. Rekomendasi Phase/Step Implementation

1. **Phase 0 — Validation & Decisions:** validate Gemma 4 E2B/Ollama on target hardware; test thinking, vision, streaming, keep-alive and settings. Freeze package identity and release repo only after owner confirms.
2. **Phase 1 — Desktop Shell & Design System:** Tauri + React + TypeScript + Rust skeleton; layout and mock data; no AI integration beyond UI placeholders.
3. **Phase 2 — Runtime Bridge & Chat:** runtime health, model selection/load, streaming, cancel, error display.
4. **Phase 3 — Settings & Runtime Lifecycle:** context, output, Thinking, parameters, automatic/manual keep-alive and manual unload.
5. **Phase 4 — Local Storage & `.AzaleaMemory`:** schema, histories, preferences, migration, custom path, backup/restore.
6. **Phase 5 — File Reader & Vision:** attachment UX and prioritized parsers, multimodal pipeline.
7. **Phase 6 — Document Engine:** DOCX/PDF generation and render validation.
8. **Phase 7 — Version Center & Manual Updater:** GitHub release check, signed artifacts, manual download progress/speed, manual install/restart.
9. **Phase 8 — Quality & Packaging:** profiling, accessibility, security, error recovery, Windows installer.

**Strict agent rule:** implement only the active phase. Before moving to the next phase, report files changed, tests run, outcomes, known issues, and ask the user whether to continue. Do not implement multiple phases in one run unless the user explicitly instructs otherwise.

## 21. Open Decisions (Jangan Mengarang Jawabannya)

- GitHub owner/repository URL.
- Final Tauri bundle identifier and product ID.
- Exact dependency versions and package manager lockfile.
- Confirmed model/runtime compatibility for Thinking and vision.
- Final minimum Windows version and installation mode.
- Whether runtime is downloaded/installed by app or documented as a prerequisite in the first MVP.
- Final database/schema for `.AzaleaMemory`.
- Whether attachments are copied into `.AzaleaMemory` by default or referenced at original locations.
- Final supported file-size/page-count limits.
- Exact update manifest endpoint and release asset naming.
- Final background animation implementation and performance threshold.

When a decision is needed, propose options with trade-offs and wait for user approval instead of silently inventing credentials, URLs, or requirements.

## 22. Official Technical References

These references are included to ground implementation decisions. Agent must re-check the current official docs when it starts implementation; do not rely solely on this PRD for version-specific API signatures.

- Tauri Windows installers: https://v2.tauri.app/distribute/windows-installer/
- Tauri updater plugin: https://v2.tauri.app/plugin/updater/
- Tauri updater JavaScript API: https://v2.tauri.app/reference/javascript/updater/
- Ollama Gemma 4 model library: https://ollama.com/library/gemma4
- Ollama Chat API: https://docs.ollama.com/api/chat
- Ollama FAQ / keep-alive: https://docs.ollama.com/faq

---

## 23. Definition of Done — PRD Stage

PRD stage is complete when:
- The user reviews and approves the product and technical direction.
- Open decisions that block Phase 0 are resolved or explicitly marked provisional.
- Agent has read this PRD, Architecture, Frontend, Backend, Roadmap and Agent Instructions.
- Each implementation phase has testable acceptance criteria.
- No phase starts before its dependencies and validation requirements are understood.

This file defines the intended product behavior. It is not proof that any feature has been implemented or tested.
