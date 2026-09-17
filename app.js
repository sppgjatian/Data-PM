(() => {
    'use strict';

    const config = window.APP_CONFIG || {};
    const SUPABASE_URL = config.supabaseUrl;
    const SUPABASE_ANON_KEY = config.supabaseAnonKey;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
        throw new Error('Konfigurasi Supabase belum lengkap.');
    }

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const STORAGE_BUCKET = 'sppg-uploads';
    const ITEMS_PER_PAGE = 20;
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const REQUIRED_COLUMNS = ['nama_lengkap', 'tanggal_lahir', 'gender', 'nik', 'kategori', 'sub_kategori'];

    let currentFile = null;
    let previewData = [];
    let schoolData = [];
    let modalData = [];
    let modalCurrentPage = 1;
    let currentSchoolFile = null;
    let isSuperUser = sessionStorage.getItem('isSuperUser') === 'true';
    let toastTimer = null;

    const $ = (id) => document.getElementById(id);

    function text(value) {
        return value == null ? '' : String(value).trim();
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    function normalizeHeader(value) {
        return text(value).toLowerCase().replace(/[\s\/-]+/g, '_');
    }

    function normalizeRow(row) {
        return Object.keys(row || {}).reduce((result, key) => {
            result[normalizeHeader(key)] = row[key];
            return result;
        }, {});
    }

    function sanitizeFileName(name) {
        const safe = text(name).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
        return (safe || 'upload').substring(0, 50);
    }

    function maskNIK(value) {
        const valueText = text(value);
        if (valueText.length <= 4) return '****';
        return valueText.slice(0, 4) + '****' + valueText.slice(-4);
    }

    function maskTanggal() {
        return '**/**/****';
    }

    function showToast(message, type = 'success') {
        const toast = $('toast');
        if (!toast) return;

        clearTimeout(toastTimer);
        toast.className = 'toast';
        if (type === 'error') toast.classList.add('error');
        if (type === 'warning') toast.classList.add('warning');

        $('toastMessage').textContent = text(message);
        toast.classList.add('show');
        toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
    }

    function setLoading(visible, message = 'Memproses...') {
        const overlay = $('loadingOverlay');
        if (overlay) overlay.style.display = visible ? 'flex' : 'none';
        const loadingText = $('loadingText');
        if (loadingText) loadingText.textContent = message;
    }

    function updateSuperUserUI() {
        const badge = $('superBadge');
        const loginBtn = $('loginBtn');
        const subtitle = $('listSubtitle');
        const sensorNotice = $('sensorNotice');
        const superNotice = $('superNotice');
        const btnDownload = $('btnDownload');

        const loggedIn = isSuperUser;

        if (badge) badge.style.display = loggedIn ? 'flex' : 'none';
        if (loginBtn) loginBtn.style.display = loggedIn ? 'none' : 'flex';
        if (subtitle) subtitle.textContent = loggedIn
            ? 'Mode Super User - Data ditampilkan lengkap tanpa sensor.'
            : 'Klik nama sekolah untuk melihat data (data sensitif disensor).';
        if (sensorNotice) sensorNotice.style.display = loggedIn ? 'none' : 'flex';
        if (superNotice) superNotice.style.display = loggedIn ? 'flex' : 'none';
        if (btnDownload) btnDownload.style.display = loggedIn ? 'flex' : 'none';
    }

    function showLoginModal() {
        $('loginModal')?.classList.add('show');
        setTimeout(() => $('loginPin')?.focus(), 100);
    }

    function closeLoginModal() {
        $('loginModal')?.classList.remove('show');
        if ($('loginError')) $('loginError').style.display = 'none';
        if ($('loginPin')) $('loginPin').value = '';
    }

    async function handleLogin(event) {
        event.preventDefault();
        const pin = text($('loginPin')?.value);
        if (!pin) return;

        try {
            const { data, error } = await supabase
                .from('super_pin')
                .select('pin')
                .eq('id', 1)
                .single();

            if (error || !data || text(data.pin) !== pin) {
                if ($('loginError')) $('loginError').style.display = 'flex';
                return;
            }

            isSuperUser = true;
            sessionStorage.setItem('isSuperUser', 'true');
            updateSuperUserUI();
            closeLoginModal();
            showToast('Login berhasil! Mode Super User aktif.');
        } catch (error) {
            console.error(error);
            if ($('loginError')) $('loginError').style.display = 'flex';
        }
    }

    function logoutSuperUser() {
        isSuperUser = false;
        sessionStorage.removeItem('isSuperUser');
        updateSuperUserUI();
        closeModal();
        showToast('Logout berhasil.');
    }

    function toggleSidebar() {
        $('sidebar')?.classList.toggle('open');
    }

    function showPage(page, trigger) {
        document.querySelectorAll('.page').forEach((item) => {
            item.style.display = 'none';
        });

        const pageElement = $('page-' + page);
        if (pageElement) pageElement.style.display = 'block';

        document.querySelectorAll('.menu-item').forEach((item) => item.classList.remove('active'));
        if (trigger) trigger.classList.add('active');

        if (page === 'list') loadSchools();
        if (window.innerWidth <= 768) $('sidebar')?.classList.remove('open');
    }

    function handleFileSelect(event) {
        const file = event.target.files?.[0];
        if (file) processFile(file);
    }

    function rejectFile(message) {
        showToast(message, 'error');
        removeFile();
    }

    function processFile(file) {
        const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        if (!['.xlsx', '.xls'].includes(extension)) {
            rejectFile('Hanya file Excel (.xlsx/.xls)!');
            return;
        }

        if (file.size > MAX_FILE_SIZE) {
            rejectFile('Maksimal ukuran file adalah 10MB!');
            return;
        }

        currentFile = file;
        const preview = $('filePreview');
        if (preview) preview.style.display = 'flex';
        const fileName = $('fileName');
        if (fileName) fileName.textContent = file.name;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
                if (!workbook.SheetNames.length) throw new Error('Sheet Excel tidak ditemukan.');

                const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' })
                    .map(normalizeRow)
                    .filter((row) => Object.keys(row).length > 0);

                if (!rows.length) {
                    rejectFile('File Excel kosong.');
                    return;
                }

                const missingColumns = REQUIRED_COLUMNS.filter((column) => !Object.prototype.hasOwnProperty.call(rows[0], column));
                if (missingColumns.length) {
                    throw new Error('Kolom wajib tidak ditemukan: ' + missingColumns.join(', '));
                }

                previewData = rows;
                showPreview(rows);
            } catch (error) {
                rejectFile(error.message || 'File Excel tidak valid.');
            }
        };

        reader.onerror = () => rejectFile('File tidak dapat dibaca.');
        reader.readAsArrayBuffer(file);
    }

    function showPreview(rows) {
        const previewSection = $('previewSection');
        const previewBody = $('previewBody');
        const rowCount = $('rowCount');

        if (!previewSection || !previewBody || !rowCount) return;

        previewSection.style.display = 'block';
        rowCount.textContent = String(rows.length);
        previewBody.innerHTML = rows.slice(0, 10).map((row, index) => {
            return '<tr>' +
                '<td>' + (index + 1) + '</td>' +
                '<td>' + escapeHtml(row.nama_lengkap || '') + '</td>' +
                '<td>' + escapeHtml(row.kategori || '') + '</td>' +
                '<td>' + escapeHtml(row.sub_kategori || '') + '</td>' +
                '</tr>';
        }).join('');
    }

    function removeFile() {
        currentFile = null;
        previewData = [];

        const fileInput = $('fileInput');
        if (fileInput) fileInput.value = '';

        const filePreview = $('filePreview');
        if (filePreview) filePreview.style.display = 'none';

        const previewSection = $('previewSection');
        if (previewSection) previewSection.style.display = 'none';
    }

    function buildRecipient(row, schoolName, uploadedAt) {
        return {
            school_name: schoolName,
            nama_lengkap: text(row.nama_lengkap).toUpperCase(),
            tanggal_lahir: text(row.tanggal_lahir),
            gender: text(row.gender).toUpperCase(),
            nik: text(row.nik).replace(/\D/g, ''),
            kategori: text(row.kategori),
            sub_kategori: text(row.sub_kategori),
            uploaded_at: uploadedAt
        };
    }

    async function handleUpload(event) {
        event.preventDefault();

        if (!currentFile || !previewData.length) {
            showToast('Pilih file Excel yang valid terlebih dahulu!', 'error');
            return;
        }

        const schoolName = text($('schoolName')?.value);
        if (!schoolName) {
            showToast('Nama sekolah wajib diisi!', 'error');
            return;
        }

        const submitBtn = $('submitBtn');
        if (submitBtn) submitBtn.disabled = true;
        setLoading(true, 'Memproses upload...');

        const timestamp = new Date().toISOString();
        const fileName = sanitizeFileName(schoolName) + '_' + Date.now() + '.xlsx';
        let storageUploaded = false;

        try {
            const uploadResult = await supabase.storage
                .from(STORAGE_BUCKET)
                .upload(fileName, currentFile, { cacheControl: '3600', upsert: false });

            if (uploadResult.error) throw uploadResult.error;
            storageUploaded = true;

            const insertUploads = await supabase.from('uploads').insert({
                school_name: schoolName,
                file_name: fileName,
                row_count: previewData.length,
                uploaded_at: timestamp
            });

            if (insertUploads.error) throw insertUploads.error;

            const rows = previewData.map((row) => buildRecipient(row, schoolName, timestamp));
            for (let index = 0; index < rows.length; index += 100) {
                const batch = rows.slice(index, index + 100);
                const { error } = await supabase.from('recipients').insert(batch);
                if (error) throw error;
            }

            showToast('Berhasil upload ' + rows.length + ' data!');
            resetForm();
        } catch (error) {
            console.error(error);
            if (storageUploaded) {
                try {
                    await supabase.storage.from(STORAGE_BUCKET).remove([fileName]);
                } catch (removeError) {
                    console.error(removeError);
                }
            }
            showToast('Gagal: ' + (error.message || 'Terjadi kesalahan'), 'error');
        } finally {
            setLoading(false);
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    function resetForm() {
        const uploadForm = $('uploadForm');
        if (uploadForm) uploadForm.reset();
        removeFile();
    }

    async function loadSchools() {
        const container = $('schoolList');
        if (!container) return;
        container.innerHTML = '<div class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Memuat...</div>';

        try {
            const { data, error } = await supabase
                .from('uploads')
                .select('school_name,file_name,row_count,uploaded_at')
                .order('uploaded_at', { ascending: false });

            if (error) throw error;
            schoolData = data || [];
            updateStats();
            renderSchools(schoolData);
        } catch (error) {
            console.error(error);
            container.innerHTML = '<div class="loading-cell" style="color:red;">Gagal memuat data.</div>';
        }
    }

    function updateStats() {
        const schools = $('statSchools');
        const total = $('statTotal');
        if (schools) schools.textContent = String(schoolData.length);
        if (total) total.textContent = String(schoolData.reduce((sum, row) => sum + (Number(row.row_count) || 0), 0));
    }

    function renderSchools(data) {
        const container = $('schoolList');
        if (!container) return;

        if (!data.length) {
            container.innerHTML = '<div class="loading-cell">Belum ada data upload.</div>';
            return;
        }

        container.innerHTML = data.map((school, index) => {
            const date = school.uploaded_at
                ? new Date(school.uploaded_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
                : '-';

            return '<div class="school-card" data-index="' + index + '">' +
                '<div class="school-card-info">' +
                '<div class="school-card-icon"><i class="fas fa-school"></i></div>' +
                '<div>' +
                '<div class="school-card-name">' + escapeHtml(school.school_name || '') + '</div>' +
                '<div class="school-card-meta">Upload: ' + date + '</div>' +
                '</div>' +
                '</div>' +
                '<div class="school-card-badge">' + (Number(school.row_count) || 0) + ' siswa</div>' +
                '</div>';
        }).join('');

        container.querySelectorAll('.school-card').forEach((card) => {
            card.addEventListener('click', () => {
                const index = Number(card.dataset.index);
                openSchoolDetail(data[index]);
            });
        });
    }

    function filterSchools() {
        const search = text($('searchSchool')?.value).toLowerCase();
        const filtered = schoolData.filter((school) => text(school.school_name).toLowerCase().includes(search));
        renderSchools(filtered);
    }

    async function openSchoolDetail(school) {
        modalCurrentPage = 1;
        currentSchoolFile = school.file_name;

        const modalTitle = $('modalTitle');
        if (modalTitle) modalTitle.textContent = text(school.school_name);

        const overlay = $('modalOverlay');
        if (overlay) overlay.classList.add('show');

        updateSuperUserUI();

        const tableBody = $('modalTableBody');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="7" class="loading-cell"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';
        }

        try {
            const { data, error } = await supabase
                .from('recipients')
                .select('nama_lengkap,nik,tanggal_lahir,gender,kategori,sub_kategori')
                .eq('school_name', school.school_name)
                .order('nama_lengkap');

            if (error) throw error;
            modalData = data || [];
            renderModalData();
        } catch (error) {
            console.error(error);
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="7" class="loading-cell" style="color:red;">Gagal memuat data.</td></tr>';
            }
        }
    }

    function renderModalData() {
        const tableBody = $('modalTableBody');
        if (!tableBody) return;

        const totalPages = Math.max(1, Math.ceil(modalData.length / ITEMS_PER_PAGE));
        modalCurrentPage = Math.min(modalCurrentPage, totalPages);
        const start = (modalCurrentPage - 1) * ITEMS_PER_PAGE;
        const visibleRows = modalData.slice(start, start + ITEMS_PER_PAGE);

        tableBody.innerHTML = visibleRows.map((row, index) => {
            const gender = text(row.gender).toUpperCase();
            const genderBadge = gender === 'P'
                ? '<span class="gender-badge gender-p">P</span>'
                : '<span class="gender-badge gender-l">L</span>';

            const nikDisplay = isSuperUser ? escapeHtml(row.nik || '') : '<span class="sensored">' + maskNIK(row.nik) + '</span>';
            const dateDisplay = isSuperUser ? escapeHtml(row.tanggal_lahir || '') : '<span class="sensored">' + maskTanggal(row.tanggal_lahir) + '</span>';

            return '<tr>' +
                '<td>' + (start + index + 1) + '</td>' +
                '<td><strong>' + escapeHtml(row.nama_lengkap || '') + '</strong></td>' +
                '<td>' + nikDisplay + '</td>' +
                '<td>' + dateDisplay + '</td>' +
                '<td>' + genderBadge + '</td>' +
                '<td>' + escapeHtml(row.kategori || '') + '</td>' +
                '<td>' + escapeHtml(row.sub_kategori || '') + '</td>' +
                '</tr>';
        }).join('');

        renderModalPagination(totalPages);
    }

    function renderModalPagination(totalPages) {
        const container = $('modalPagination');
        if (!container) return;

        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '<button ' + (modalCurrentPage === 1 ? 'disabled' : '') + ' data-page="' + (modalCurrentPage - 1) + '"><i class="fas fa-chevron-left"></i></button>';

        for (let page = 1; page <= totalPages; page++) {
            if (page === 1 || page === totalPages || Math.abs(page - modalCurrentPage) <= 2) {
                html += '<button class="' + (page === modalCurrentPage ? 'active' : '') + '" data-page="' + page + '">' + page + '</button>';
            }
        }

        html += '<button ' + (modalCurrentPage === totalPages ? 'disabled' : '') + ' data-page="' + (modalCurrentPage + 1) + '"><i class="fas fa-chevron-right"></i></button>';
        container.innerHTML = html;

        container.querySelectorAll('button[data-page]').forEach((button) => {
            button.addEventListener('click', () => {
                const targetPage = Number(button.dataset.page);
                if (Number.isNaN(targetPage)) return;
                if (targetPage < 1 || targetPage > totalPages) return;
                modalCurrentPage = targetPage;
                renderModalData();
            });
        });
    }

    function closeModal() {
        $('modalOverlay')?.classList.remove('show');
        currentSchoolFile = null;
        modalData = [];
    }

    async function downloadExcel() {
        if (!isSuperUser) {
            showToast('Login Super User diperlukan.', 'error');
            return;
        }

        if (!currentSchoolFile) {
            showToast('File tidak ditemukan!', 'error');
            return;
        }

        setLoading(true, 'Menyiapkan download...');

        try {
            const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(currentSchoolFile);
            if (error) throw error;

            const url = URL.createObjectURL(data);
            const link = document.createElement('a');
            link.href = url;
            link.download = currentSchoolFile;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            showToast('Download berhasil!');
        } catch (error) {
            console.error(error);
            showToast('Gagal download: ' + (error.message || 'Terjadi kesalahan'), 'error');
        } finally {
            setLoading(false);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateSuperUserUI();

        const dropZone = $('dropZone');
        if (dropZone) {
            dropZone.addEventListener('dragover', (event) => {
                event.preventDefault();
                dropZone.classList.add('dragover');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragover');
            });

            dropZone.addEventListener('drop', (event) => {
                event.preventDefault();
                dropZone.classList.remove('dragover');
                const file = event.dataTransfer.files?.[0];
                if (file) processFile(file);
            });
        }
    });

    window.toggleSidebar = toggleSidebar;
    window.showPage = showPage;
    window.showLoginModal = showLoginModal;
    window.closeLoginModal = closeLoginModal;
    window.handleLogin = handleLogin;
    window.logoutSuperUser = logoutSuperUser;
    window.handleFileSelect = handleFileSelect;
    window.removeFile = removeFile;
    window.handleUpload = handleUpload;
    window.resetForm = resetForm;
    window.filterSchools = filterSchools;
    window.closeModal = closeModal;
    window.downloadExcel = downloadExcel;
})();
