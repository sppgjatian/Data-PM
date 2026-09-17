// ===== SUPABASE CONFIG =====
const SUPABASE_URL = 'https://qgwlzezedymelpzgpyju.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnd2x6ZXplZHltZWxwemdweWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTI4OTUsImV4cCI6MjEwNTIyODg5NX0.PkHWQJRc2IHwTXRaccdJljH6Vpe1IN1ckszGjuE3hks';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== STATE =====
let currentFile = null;
let previewData = [];
let schoolData = [];
let modalCurrentPage = 1;
let currentSchoolFile = null;
const ITEMS_PER_PAGE = 20;

let isSuperUser = sessionStorage.getItem('isSuperUser') === 'true';

// ===== HELPERS =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function sanitizeFileName(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_{2,}/g, '_').substring(0, 50);
}

function maskNIK(nik) {
    const str = String(nik || '');
    if (str.length <= 4) return '****';
    return str.substring(0, 4) + '****' + str.substring(str.length - 4);
}

function maskTanggal(tgl) {
    if (!tgl) return '-';
    return '**/**/****';
}

// ===== SUPER USER =====
function updateSuperUserUI() {
    const badge = document.getElementById('superBadge');
    const loginBtn = document.getElementById('loginBtn');
    const subtitle = document.getElementById('listSubtitle');
    const sensorNotice = document.getElementById('sensorNotice');
    const superNotice = document.getElementById('superNotice');
    const btnDownload = document.getElementById('btnDownload');

    if (isSuperUser) {
        if (badge) badge.style.display = 'flex';
        if (loginBtn) loginBtn.style.display = 'none';
        if (subtitle) subtitle.textContent = 'Mode Super User - Data ditampilkan lengkap tanpa sensor.';
        if (sensorNotice) sensorNotice.style.display = 'none';
        if (superNotice) superNotice.style.display = 'flex';
        if (btnDownload) btnDownload.style.display = 'flex';
    } else {
        if (badge) badge.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'flex';
        if (subtitle) subtitle.textContent = 'Klik nama sekolah untuk melihat data (data sensitif disensor).';
        if (sensorNotice) sensorNotice.style.display = 'flex';
        if (superNotice) superNotice.style.display = 'none';
        if (btnDownload) btnDownload.style.display = 'none';
    }
}

function showLoginModal() {
    document.getElementById('loginModal').classList.add('show');
    setTimeout(function() {
        document.getElementById('loginPin').focus();
    }, 100);
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.remove('show');
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('loginPin').value = '';
}

async function handleLogin(e) {
    e.preventDefault();
    const pin = document.getElementById('loginPin').value.trim();

    try {
        const { data, error } = await supabase
            .from('super_pin')
            .select('pin')
            .eq('id', 1)
            .single();

        if (error || !data || data.pin !== pin) {
            document.getElementById('loginError').style.display = 'flex';
            return;
        }

        isSuperUser = true;
        sessionStorage.setItem('isSuperUser', 'true');
        updateSuperUserUI();
        closeLoginModal();
        showToast('Login berhasil! Mode Super User aktif.', 'success');

    } catch (error) {
        document.getElementById('loginError').style.display = 'flex';
    }
}

function logoutSuperUser() {
    isSuperUser = false;
    sessionStorage.removeItem('isSuperUser');
    updateSuperUserUI();
    showToast('Logout berhasil.', 'success');
    closeModal();
}

// ===== SIDEBAR =====
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

function showPage(page) {
    document.querySelectorAll('.page').forEach(function(p) { p.style.display = 'none'; });
    document.getElementById('page-' + page).style.display = 'block';
    document.querySelectorAll('.menu-item').forEach(function(i) { i.classList.remove('active'); });
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
    if (page === 'list') loadSchools();
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
}

// ===== FILE HANDLING =====
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processFile(file);
}

function processFile(file) {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (['.xlsx', '.xls'].indexOf(ext) === -1) {
        showToast('Hanya file Excel (.xlsx/.xls)!', 'error');
        removeFile();
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast('Maksimal 10MB!', 'error');
        removeFile();
        return;
    }

    currentFile = file;
    document.getElementById('filePreview').style.display = 'flex';
    document.getElementById('fileName').textContent = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (json.length === 0) {
                showToast('File kosong!', 'error');
                removeFile();
                return;
            }

            previewData = json;
            showPreview(json);
        } catch (err) {
            showToast('Gagal baca file: ' + err.message, 'error');
            removeFile();
        }
    };
    reader.readAsArrayBuffer(file);
}

function showPreview(data) {
    document.getElementById('previewSection').style.display = 'block';
    document.getElementById('rowCount').textContent = data.length;
    const tbody = document.getElementById('previewBody');
    tbody.innerHTML = '';

    data.slice(0, 10).forEach(function(row, i) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + (i + 1) + '</td>' +
            '<td>' + escapeHtml(row.nama_lengkap) + '</td>' +
            '<td>' + escapeHtml(row.kategori) + '</td>' +
            '<td>' + escapeHtml(row.sub_kategori) + '</td>';
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

// ===== UPLOAD =====
async function handleUpload(e) {
    e.preventDefault();
    if (!currentFile) {
        showToast('Pilih file dulu!', 'error');
        return;
    }

    const schoolName = document.getElementById('schoolName').value.trim();
    if (!schoolName) {
        showToast('Nama sekolah wajib diisi!', 'error');
        return;
    }

    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('loadingText').textContent = 'Memproses upload...';
    document.getElementById('submitBtn').disabled = true;

    try {
        const timestamp = new Date().toISOString();
        const fileName = sanitizeFileName(schoolName) + '_' + Date.now() + '.xlsx';

        const storageResult = await supabase.storage
            .from('sppg-uploads')
            .upload(fileName, currentFile, { cacheControl: '3600', upsert: false });

        if (storageResult.error) throw storageResult.error;

        const dbResult = await supabase.from('uploads').insert({
            school_name: schoolName,
            file_name: fileName,
            row_count: previewData.length,
            uploaded_at: timestamp
        });

        if (dbResult.error) throw dbResult.error;

        const rows = previewData.map(function(row) {
            return {
                school_name: schoolName,
                nama_lengkap: String(row.nama_lengkap || '').toUpperCase(),
                tanggal_lahir: String(row.tanggal_lahir || ''),
                gender: String(row.gender || '').toUpperCase(),
                nik: String(row.nik || '').replace(/\D/g, ''),
                kategori: String(row.kategori || ''),
                sub_kategori: String(row.sub_kategori || ''),
                uploaded_at: timestamp
            };
        });

        for (let i = 0; i < rows.length; i += 100) {
            const batchResult = await supabase.from('recipients').insert(rows.slice(i, i + 100));
            if (batchResult.error) throw batchResult.error;
        }

        showToast('Berhasil upload ' + previewData.length + ' data!', 'success');
        resetForm();

    } catch (error) {
        console.error(error);
        showToast('Gagal: ' + (error.message || 'Terjadi kesalahan'), 'error');
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
        document.getElementById('submitBtn').disabled = false;
    }
}

function resetForm() {
    document.getElementById('uploadForm').reset();
    removeFile();
}

// ===== LOAD SCHOOLS =====
async function loadSchools() {
    const container = document.getElementById('schoolList');
    container.innerHTML = '<div class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Memuat...</div>';

    try {
        const result = await supabase
            .from('uploads')
            .select('*')
            .order('uploaded_at', { ascending: false });

        if (result.error) throw result.error;

        schoolData = result.data || [];
        updateStats();
        renderSchools(schoolData);

    } catch (error) {
        container.innerHTML = '<div class="loading-cell" style="color:red;">Gagal memuat data.</div>';
    }
}

function updateStats() {
    const total = schoolData.reduce(function(sum, s) { return sum + (s.row_count || 0); }, 0);
    document.getElementById('statSchools').textContent = schoolData.length;
    document.getElementById('statTotal').textContent = total;
}

function renderSchools(data) {
    const container = document.getElementById('schoolList');

    if (data.length === 0) {
        container.innerHTML = '<div class="loading-cell">Belum ada data upload.</div>';
        return;
    }

    container.innerHTML = '';
    data.forEach(function(school) {
        const date = school.uploaded_at
            ? new Date(school.uploaded_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
            : '-';

        const card = document.createElement('div');
        card.className = 'school-card';
        card.onclick = function() { openSchoolDetail(school); };
        card.innerHTML = '<div class="school-card-info">' +
            '<div class="school-card-icon"><i class="fas fa-school"></i></div>' +
            '<div>' +
            '<div class="school-card-name">' + escapeHtml(school.school_name) + '</div>' +
            '<div class="school-card-meta">Upload: ' + date + '</div>' +
            '</div></div>' +
            '<div class="school-card-badge">' + (school.row_count || 0) + ' siswa</div>';
        container.appendChild(card);
    });
}

function filterSchools() {
    const search = document.getElementById('searchSchool').value.toLowerCase();
    const filtered = schoolData.filter(function(s) {
        return s.school_name.toLowerCase().indexOf(search) !== -1;
    });
    renderSchools(filtered);
}

// ===== MODAL DETAIL =====
async function openSchoolDetail(school) {
    modalCurrentPage = 1;
    currentSchoolFile = school.file_name;
    document.getElementById('modalTitle').textContent = school.school_name;
    document.getElementById('modalOverlay').classList.add('show');
    updateSuperUserUI();

    const tbody = document.getElementById('modalTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';

    try {
        const result = await supabase
            .from('recipients')
            .select('*')
            .eq('school_name', school.school_name)
            .order('nama_lengkap');

        if (result.error) throw result.error;

        renderModalData(result.data || []);

    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-cell" style="color:red;">Gagal memuat data.</td></tr>';
    }
}

function renderModalData(data) {
    const tbody = document.getElementById('modalTableBody');
    const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE);
    const start = (modalCurrentPage - 1) * ITEMS_PER_PAGE;
    const pageData = data.slice(start, start + ITEMS_PER_PAGE);

    tbody.innerHTML = '';
    pageData.forEach(function(row, i) {
        const genderBadge = row.gender === 'P'
            ? '<span style="background:#fce4ec;color:#c62828;padding:2px 8px;border-radius:4px;font-size:11px;">P</span>'
            : '<span style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:4px;font-size:11px;">L</span>';

        const nikDisplay = isSuperUser
            ? escapeHtml(row.nik)
            : '<span class="sensored">' + maskNIK(row.nik) + '</span>';
        const tglDisplay = isSuperUser
            ? escapeHtml(row.tanggal_lahir)
            : '<span class="sensored">' + maskTanggal(row.tanggal_lahir) + '</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + (start + i + 1) + '</td>' +
            '<td><strong>' + escapeHtml(row.nama_lengkap) + '</strong></td>' +
            '<td>' + nikDisplay + '</td>' +
            '<td>' + tglDisplay + '</td>' +
            '<td>' + genderBadge + '</td>' +
            '<td>' + escapeHtml(row.kategori) + '</td>' +
            '<td>' + escapeHtml(row.sub_kategori) + '</td>';
        tbody.appendChild(tr);
    });

    renderModalPagination(totalPages, data);
}

function renderModalPagination(totalPages, allData) {
    const container = document.getElementById('modalPagination');
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += '<button ' + (modalCurrentPage === 1 ? 'disabled' : '') + ' onclick="modalGoPage(' + (modalCurrentPage - 1) + ')"><i class="fas fa-chevron-left"></i></button>';

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= modalCurrentPage - 2 && i <= modalCurrentPage + 2)) {
            html += '<button class="' + (i === modalCurrentPage ? 'active' : '') + '" onclick="modalGoPage(' + i + ')">' + i + '</button>';
        } else if (i === modalCurrentPage - 3 || i === modalCurrentPage + 3) {
            html += '<button disabled>...</button>';
        }
    }

    html += '<button ' + (modalCurrentPage === totalPages ? 'disabled' : '') + ' onclick="modalGoPage(' + (modalCurrentPage + 1) + ')"><i class="fas fa-chevron-right"></i></button>';
    container.innerHTML = html;
}

function modalGoPage(page) {
    modalCurrentPage = page;
    const schoolName = document.getElementById('modalTitle').textContent;
    supabase.from('recipients').select('*').eq('school_name', schoolName).order('nama_lengkap').then(function(result) {
        if (result.data) renderModalData(result.data);
    });
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
    currentSchoolFile = null;
}

// ===== DOWNLOAD EXCEL ASLI =====
async function downloadExcel() {
    if (!currentSchoolFile) {
        showToast('File tidak ditemukan!', 'error');
        return;
    }

    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('loadingText').textContent = 'Menyiapkan download...';

    try {
        const result = await supabase.storage
            .from('sppg-uploads')
            .download(currentSchoolFile);

        if (result.error) throw result.error;

        const url = URL.createObjectURL(result.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentSchoolFile;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Download berhasil! File Excel asli.', 'success');

    } catch (error) {
        console.error(error);
        showToast('Gagal download: ' + error.message, 'error');
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

// ===== TOAST =====
function showToast(message, type) {
    type = type || 'success';
    const toast = document.getElementById('toast');
    toast.className = 'toast';
    if (type === 'error') toast.classList.add('error');
    if (type === 'warning') toast.classList.add('warning');
    document.getElementById('toastMessage').textContent = message;
    toast.classList.add('show');
    setTimeout(function() {
        toast.classList.remove('show');
    }, 4000);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function() {
    updateSuperUserUI();
    
    // Setup drag & drop
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', function() {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) {
                document.getElementById('fileInput').files = e.dataTransfer.files;
                processFile(file);
            }
        });
    }
});
