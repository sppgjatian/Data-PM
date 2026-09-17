// ===== SUPABASE CONFIGURATION =====
const SUPABASE_URL = 'https://qgwlzezedymelpzgpyju.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnd2x6ZXplZHltZWxwemdweWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTI4OTUsImV4cCI6MjEwNTIyODg5NX0.PkHWQJRc2IHwTXRaccdJljH6Vpe1IN1ckszGjuE3hks';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== GLOBAL STATE =====
let currentFile = null;
let previewData = [];
let allData = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 25;

// ===== SIDEBAR TOGGLE =====
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ===== PAGE NAVIGATION =====
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById(`page-${page}`).style.display = 'block';

    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    event.currentTarget.classList.add('active');

    if (page === 'list') {
        loadData();
    }

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
    }
}

// ===== FILE HANDLING =====
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        processFile(file);
    }
}

function processFile(file) {
    const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ];
    const validExtensions = ['.xlsx', '.xls'];
    const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!validExtensions.includes(extension)) {
        showToast('Hanya file Excel (.xlsx/.xls) yang diperbolehkan!', 'error');
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        showToast('Ukuran file maksimal 10MB!', 'error');
        return;
    }

    currentFile = file;

    // Show file preview
    document.getElementById('filePreview').style.display = 'flex';
    document.getElementById('fileName').textContent = file.name;

    // Parse Excel
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

            previewData = jsonData;
            showPreview(jsonData);
        } catch (err) {
            showToast('Gagal membaca file Excel: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function showPreview(data) {
    const section = document.getElementById('previewSection');
    const tbody = document.getElementById('previewBody');
    const rowCount = document.getElementById('rowCount');

    section.style.display = 'block';
    rowCount.textContent = data.length;

    tbody.innerHTML = '';

    data.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${row.nama_lengkap || '-'}</td>
            <td>${row.tanggal_lahir || '-'}</td>
            <td>${row.gender || '-'}</td>
            <td>${row.nik || '-'}</td>
            <td>${row.type || '-'}</td>
            <td>${row.identity_code || '-'}</td>
            <td>${row.kategori || '-'}</td>
            <td>${row.sub_kategori || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function removeFile() {
    currentFile = null;
    previewData = [];
    document.getElementById('fileInput').value = '';
    document.getElementById('filePreview').style.display = 'none';
    document.getElementById('previewSection').style.display = 'none';
}

// ===== DRAG & DROP =====
const dropZone = document.getElementById('dropZone');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
        document.getElementById('fileInput').files = e.dataTransfer.files;
        processFile(file);
    }
});

// ===== UPLOAD HANDLER =====
async function handleUpload(event) {
    event.preventDefault();

    if (!currentFile) {
        showToast('Pilih file Excel terlebih dahulu!', 'error');
        return;
    }

    const sppgName = document.getElementById('sppgName').value.trim();
    const category = document.getElementById('category').value;
    const picName = document.getElementById('picName').value.trim();
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    const identityCode = document.getElementById('identityCode').value.trim();
    const identityType = document.getElementById('identityType').value;

    if (!sppgName || !category || !picName || !phoneNumber || !identityCode) {
        showToast('Lengkapi semua field yang wajib diisi!', 'error');
        return;
    }

    // Validate Excel data
    const requiredColumns = ['nama_lengkap', 'tanggal_lahir', 'gender', 'nik', 'type', 'identity_code', 'kategori', 'sub_kategori'];
    const firstRow = previewData[0];
    const missingColumns = requiredColumns.filter(col => !(col in firstRow));

    if (missingColumns.length > 0) {
        showToast(`Kolom yang hilang: ${missingColumns.join(', ')}. Gunakan template yang benar!`, 'error');
        return;
    }

    // Show loading
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('submitBtn').disabled = true;

    try {
        const uploadTimestamp = new Date().toISOString();
        const fileName = `${sppgName.replace(/\s+/g, '_')}_${Date.now()}.xlsx`;

        // 1. Upload file to Supabase Storage
        const { data: storageData, error: storageError } = await supabase.storage
            .from('sppg-uploads')
            .upload(fileName, currentFile, {
                cacheControl: '3600',
                upsert: false
            });

        if (storageError) throw storageError;

        // 2. Insert metadata to database
        const { error: dbError } = await supabase
            .from('uploads')
            .insert({
                sppg_name: sppgName,
                category: category,
                pic_name: picName,
                phone_number: phoneNumber,
                identity_code: identityCode,
                identity_type: identityType,
                file_name: fileName,
                file_url: storageData.fullPath,
                row_count: previewData.length,
                uploaded_at: uploadTimestamp
            });

        if (dbError) throw dbError;

        // 3. Insert each row to recipients table
        const recipientRows = previewData.map(row => ({
            sppg_name: sppgName,
            nama_lengkap: String(row.nama_lengkap || '').toUpperCase(),
            tanggal_lahir: String(row.tanggal_lahir || ''),
            gender: String(row.gender || '').toUpperCase(),
            nik: String(row.nik || ''),
            type: String(row.type || ''),
            identity_code: String(row.identity_code || ''),
            kategori: String(row.kategori || ''),
            sub_kategori: String(row.sub_kategori || ''),
            upload_id: null, // will be updated
            uploaded_at: uploadTimestamp
        }));

        // Insert in batches of 100
        for (let i = 0; i < recipientRows.length; i += 100) {
            const batch = recipientRows.slice(i, i + 100);
            const { error: batchError } = await supabase
                .from('recipients')
                .insert(batch);

            if (batchError) {
                console.error('Batch insert error:', batchError);
            }
        }

        showToast(`Berhasil upload ${previewData.length} data penerima manfaat!`, 'success');
        resetForm();

    } catch (error) {
        console.error('Upload error:', error);
        showToast('Gagal upload: ' + error.message, 'error');
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
        document.getElementById('submitBtn').disabled = false;
    }
}

// ===== LOAD DATA =====
async function loadData() {
    const tbody = document.getElementById('dataTableBody');
    tbody.innerHTML = '<tr><td colspan="9" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Memuat data...</td></tr>';

    try {
        const { data, error } = await supabase
            .from('recipients')
            .select('*')
            .order('uploaded_at', { ascending: false });

        if (error) throw error;

        allData = data || [];
        updateStats(allData);
        renderTable(allData);

    } catch (error) {
        console.error('Load error:', error);
        tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">Gagal memuat data. Periksa konfigurasi Supabase.</td></tr>';
    }
}

// ===== UPDATE STATS =====
function updateStats(data) {
    const sppgSet = new Set(data.map(d => d.sppg_name));
    const female = data.filter(d => d.gender === 'P').length;
    const male = data.filter(d => d.gender === 'L').length;

    document.getElementById('statSPPG').textContent = sppgSet.size;
    document.getElementById('statTotal').textContent = data.length;
    document.getElementById('statFemale').textContent = female;
    document.getElementById('statMale').textContent = male;
}

// ===== RENDER TABLE =====
function renderTable(data) {
    const tbody = document.getElementById('dataTableBody');
    const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageData = data.slice(start, end);

    if (pageData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">Belum ada data yang diupload.</td></tr>';
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    tbody.innerHTML = '';
    pageData.forEach((row, index) => {
        const tr = document.createElement('tr');
        const genderBadge = row.gender === 'P'
            ? '<span style="background:#fce4ec;color:#c62828;padding:2px 8px;border-radius:4px;font-size:11px;">P</span>'
            : '<span style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:4px;font-size:11px;">L</span>';

        const dateStr = row.uploaded_at
            ? new Date(row.uploaded_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
            : '-';

        tr.innerHTML = `
            <td>${start + index + 1}</td>
            <td><strong>${row.nama_lengkap || '-'}</strong></td>
            <td>${row.tanggal_lahir || '-'}</td>
            <td>${genderBadge}</td>
            <td style="font-family:monospace;">${row.nik || '-'}</td>
            <td>${row.sppg_name || '-'}</td>
            <td><span style="background:#e8f0fe;color:#1a3a6b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${row.kategori || '-'}</span></td>
            <td>${row.sub_kategori || '-'}</td>
            <td>${dateStr}</td>
        `;
        tbody.appendChild(tr);
    });

    renderPagination(totalPages);
}

// ===== PAGINATION =====
function renderPagination(totalPages) {
    const container = document.getElementById('pagination');
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})"><i class="fas fa-chevron-left"></i></button>`;

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            html += `<button class="${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += `<button disabled>...</button>`;
        }
    }

    html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})"><i class="fas fa-chevron-right"></i></button>`;

    container.innerHTML = html;
}

function goToPage(page) {
    currentPage = page;
    const filtered = getFilteredData();
    renderTable(filtered);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== FILTER =====
function getFilteredData() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const category = document.getElementById('filterCategory').value;

    return allData.filter(row => {
        const matchSearch = !search ||
            (row.nama_lengkap && row.nama_lengkap.toLowerCase().includes(search)) ||
            (row.nik && row.nik.includes(search)) ||
            (row.sppg_name && row.sppg_name.toLowerCase().includes(search)) ||
            (row.sub_kategori && row.sub_kategori.toLowerCase().includes(search));

        const matchCategory = !category || row.kategori === category;

        return matchSearch && matchCategory;
    });
}

function filterData() {
    currentPage = 1;
    const filtered = getFilteredData();
    updateStats(filtered);
    renderTable(filtered);
}

// ===== RESET FORM =====
function resetForm() {
    document.getElementById('uploadForm').reset();
    removeFile();
}

// ===== TOAST =====
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    toast.className = 'toast';
    if (type === 'error') toast.classList.add('error');
    if (type === 'warning') toast.classList.add('warning');

    toastMessage.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    // Auto-load data if on list page
    console.log('SIPGN Upload Portal initialized');
    console.log('Supabase URL:', SUPABASE_URL);
});