/* ==========================================================================
   TROPICAL GRILL - CONTROL DE SALARIOS
   Lógica JavaScript Principal (Vanilla JS - Sin Dependencias Externas)
   ========================================================================== */

// CLAVE PRINCIPAL DE LOCALSTORAGE (se conserva como respaldo local)
const STORAGE_KEY = 'TROPICAL_GRILL_DATA_V4';

// CONFIGURACIÓN DE FIREBASE / FIRESTORE
// Esta configuración identifica el proyecto web; las reglas de Firestore
// determinan quién puede acceder realmente a los datos.
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyA_LjRWZr2EghWzVMQMGAKzeDPDHedygZg',
    authDomain: 'tropicalpagos-55d9c.firebaseapp.com',
    projectId: 'tropicalpagos-55d9c',
    storageBucket: 'tropicalpagos-55d9c.firebasestorage.app',
    messagingSenderId: '550359954901',
    appId: '1:550359954901:web:28a5f87cbd4033574fb95c',
    measurementId: 'G-R3ZFMK9L7L'
};
const FIRESTORE_COLLECTION = 'tropicalPagos';
const FIRESTORE_DOCUMENT = 'datos';
let firestoreDb = null;
let firestoreSyncQueue = Promise.resolve();

try {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
        firestoreDb = firebase.firestore();
    }
} catch (error) {
    console.error('No se pudo inicializar Firebase:', error);
}

// CONTRASEÑA OFICIAL DEL SISTEMA Y ENCARGADO
const ADMIN_PASSWORD = 'Tropical26.';
let isSystemUnlocked = false;

// ESTADO GLOBAL DE LA APLICACIÓN
let appData = {
    trabajadores: [],
    reportesGuardados: []
};

// ESTADO EN MEMORIA DEL CÁLCULO ACTUAL (BORRADOR EN VIVO)
let currentDraftPayroll = {
    fechaDesde: '',
    fechaHasta: '',
    fechaPago: '',
    trabajadores: []
};

// CALLBACKS GLOBALES
let pendingConfirmCallback = null;

// ==========================================================================
// 1. INICIALIZACIÓN Y LOGIN INICIAL OBLIGATORIO
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
    await cargarDatos();
    initUI();
    
    // Enfocar campo de contraseña en pantalla de inicio
    const loginInput = document.getElementById('login-password-input');
    if (loginInput) loginInput.focus();
});

function handleSystemLoginSubmit(e) {
    e.preventDefault();
    const passInput = document.getElementById('login-password-input').value;

    if (passInput === ADMIN_PASSWORD) {
        isSystemUnlocked = true;
        
        // Ocultar pantalla de login y desbloquear aplicación
        const loginScreen = document.getElementById('app-login-screen');
        const appWrapper = document.getElementById('app-content-wrapper');

        if (loginScreen) loginScreen.style.display = 'none';
        if (appWrapper) appWrapper.classList.remove('app-locked');

        renderAllViews();
        showToast('🔑 Acceso concedido. Bienvenido a Tropical Grill.', 'success');
    } else {
        showToast('Contraseña incorrecta. Acceso denegado.', 'error');
        document.getElementById('login-password-input').value = '';
        document.getElementById('login-password-input').focus();
    }
}

function handleSystemLogout() {
    isSystemUnlocked = false;

    const loginScreen = document.getElementById('app-login-screen');
    const appWrapper = document.getElementById('app-content-wrapper');
    const passwordInput = document.getElementById('login-password-input');
    const mainNav = document.getElementById('main-nav');

    if (mainNav) mainNav.classList.remove('open');
    if (passwordInput) passwordInput.value = '';
    if (appWrapper) appWrapper.classList.add('app-locked');
    if (loginScreen) loginScreen.style.display = 'flex';

    setTimeout(() => passwordInput?.focus(), 50);
}

function asegurarEstructuraDatos() {
    if (!appData || typeof appData !== 'object') appData = {};
    if (!Array.isArray(appData.trabajadores)) appData.trabajadores = [];
    if (!Array.isArray(appData.reportesGuardados)) appData.reportesGuardados = [];
}

async function cargarDatos() {
    let hayRespaldoLocal = false;

    try {
        const json = localStorage.getItem(STORAGE_KEY);
        if (json) {
            appData = JSON.parse(json);
            hayRespaldoLocal = true;
        }
    } catch (e) {
        console.error('Error al cargar localStorage:', e);
        appData = { trabajadores: [], reportesGuardados: [] };
    }

    asegurarEstructuraDatos();

    if (!firestoreDb) {
        sanearIdsTrabajadores();
        if (!hayRespaldoLocal) guardarDatos();
        return;
    }

    try {
        const reference = firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOCUMENT);
        const snapshot = await reference.get();

        if (snapshot.exists && snapshot.data().appData) {
            appData = snapshot.data().appData;
            asegurarEstructuraDatos();
            sanearIdsTrabajadores();
            // Mantiene una copia de respaldo en el navegador que se está usando.
            localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        } else {
            // La primera computadora que conecte el sistema sube su información local.
            // Si estaba vacía, crea el documento inicial en Firestore.
            guardarDatos();
        }
    } catch (e) {
        console.error('Error al cargar Firestore; se usará el respaldo local:', e);
        sanearIdsTrabajadores();
        if (!hayRespaldoLocal) guardarDatos();
    }
}

function obtenerSiguienteIdTrabajador() {
    let maxNum = 0;
    if (appData.trabajadores && appData.trabajadores.length > 0) {
        appData.trabajadores.forEach(w => {
            if (w.id) {
                const matches = String(w.id).match(/\d+/);
                if (matches) {
                    const num = parseInt(matches[0], 10);
                    if (!isNaN(num) && num < 1000000 && num > maxNum) {
                        maxNum = num;
                    }
                }
            }
        });
    }
    return `tr_${maxNum + 1}`;
}

function sanearIdsTrabajadores(forceReindex = false) {
    if (!appData.trabajadores) return;
    
    // Quitar trabajadores por defecto que fueron marcados como inactivos (datos de prueba)
    const nombresPrueba = ['emily', 'juan pérez', 'juan perez', 'maría lópez', 'maria lopez', 'pedro gómez', 'pedro gomez'];
    const lengthBefore = appData.trabajadores.length;
    
    appData.trabajadores = appData.trabajadores.filter(w => {
        const esTest = nombresPrueba.includes(w.nombre.toLowerCase().trim());
        return !(esTest && !w.activo);
    });

    const huboCambiosEnLista = appData.trabajadores.length !== lengthBefore;

    const hayTimestampIds = appData.trabajadores.some(w => {
        const matches = w.id ? String(w.id).match(/\d+/) : null;
        return matches && parseInt(matches[0], 10) >= 1000000;
    });

    if (hayTimestampIds || forceReindex || huboCambiosEnLista) {
        appData.trabajadores.forEach((w, index) => {
            w.id = `tr_${index + 1}`;
        });
        guardarDatos();
    }
}

function guardarDatos() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    } catch (e) {
        console.error('Error al guardar en localStorage:', e);
        showToast('Error al guardar los datos localmente.', 'error');
    }

    if (firestoreDb) {
        // La cola evita que dos cambios rápidos lleguen a Firestore en desorden.
        const dataSnapshot = JSON.parse(JSON.stringify(appData));
        firestoreSyncQueue = firestoreSyncQueue
            .catch(() => undefined)
            .then(() => firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOCUMENT).set({
                appData: dataSnapshot,
                actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
            }))
            .catch(error => console.error('Error al guardar en Firestore:', error));
    }
}

function inicializarDatosPorDefecto() {
    appData.trabajadores = [];
    appData.reportesGuardados = [];
    guardarDatos();
}

// ==========================================================================
// 2. NAVEGACIÓN DE LA APLICACIÓN
// ==========================================================================

function initUI() {
    // Configurar menú principal (3 botones)
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            if (!tab) return;
            switchTab(tab);
        });
    });

    // Toggle menú móvil
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const mainNav = document.getElementById('main-nav');
    if (mobileBtn && mainNav) {
        mobileBtn.addEventListener('click', () => mainNav.classList.toggle('open'));
    }

    // Ir a pestaña principal al pulsar logo
    const brandBtn = document.getElementById('brand-home-btn');
    if (brandBtn) {
        brandBtn.addEventListener('click', () => switchTab('calculo'));
    }

    // Configurar fechas del sistema
    const hoyStr = getFechaHoyString();
    document.getElementById('auto-system-date-display').textContent = formatDateDisplay(hoyStr);
    
    document.getElementById('calc-desde').value = hoyStr;
    document.getElementById('calc-hasta').value = hoyStr;

    currentDraftPayroll.fechaPago = hoyStr;
    currentDraftPayroll.fechaDesde = hoyStr;
    currentDraftPayroll.fechaHasta = hoyStr;
}

function switchTab(tabId) {
    if (!isSystemUnlocked) return;

    const navButtons = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const mainNav = document.getElementById('main-nav');

    navButtons.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    tabContents.forEach(content => {
        if (content.id === `section-${tabId}`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    if (mainNav) mainNav.classList.remove('open');

    if (tabId === 'calculo') {
        populateWorkersDatalist();
        updateLiveReportHeader();
        renderDraftTable();
    } else if (tabId === 'trabajadores') {
        renderWorkers();
    } else if (tabId === 'reportes') {
        renderSavedReportsList();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAllViews() {
    populateWorkersDatalist();
    updateLiveReportHeader();
    renderDraftTable();
    renderWorkers();
    renderSavedReportsList();
}

// ==========================================================================
// 3. SECCIÓN REALIZAR CÁLCULO Y MINI REPORTE EN VIVO
// ==========================================================================

function updateLiveReportHeader() {
    const desde = document.getElementById('calc-desde').value;
    const hasta = document.getElementById('calc-hasta').value;
    const hoyStr = getFechaHoyString();

    currentDraftPayroll.fechaDesde = desde;
    currentDraftPayroll.fechaHasta = hasta;
    currentDraftPayroll.fechaPago = hoyStr;

    const desdeTxt = desde ? formatDateDisplay(desde) : '--/--/----';
    const hastaTxt = hasta ? formatDateDisplay(hasta) : '--/--/----';

    document.getElementById('live-rep-periodo').textContent = `${desdeTxt} AL ${hastaTxt}`;
    document.getElementById('live-rep-fecha-pago').textContent = formatDateDisplay(hoyStr);
}

// Llenar datalist para búsqueda predictiva de trabajadores (Ej: Emily)
function populateWorkersDatalist() {
    const datalist = document.getElementById('workers-datalist');
    if (!datalist) return;
    datalist.innerHTML = '';

    const activos = appData.trabajadores.filter(w => w.activo);
    activos.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.nombre;
        datalist.appendChild(opt);
    });
}

function onDraftWorkerSearchInput() {
    const val = (document.getElementById('draft-worker-input').value || '').trim().toLowerCase();
    const hiddenId = document.getElementById('draft-worker-id');
    
    const worker = appData.trabajadores.find(w => w.activo && w.nombre.toLowerCase() === val);
    
    if (worker) {
        hiddenId.value = worker.id;
    } else {
        hiddenId.value = '';
    }

    calculateWorkerMiniReportLive();
}

function toggleDraftHolidayInput() {
    const isHoliday = document.getElementById('draft-feriado').value === 'si';
    const group = document.getElementById('group-draft-aumento');
    if (group) {
        group.style.display = isHoliday ? 'block' : 'none';
        if (!isHoliday) {
            document.getElementById('draft-aumento').value = '0.00';
        }
    }
}

// FÓRMULA EXACTA ESPECIFICADA
function computeSalaryValues(horas, minutos, pagoPorHora, esFeriado, aumentoFeriado) {
    const h = Math.max(0, parseInt(horas) || 0);
    const m = Math.max(0, Math.min(59, parseInt(minutos) || 0));
    const rate = Math.max(0, parseFloat(pagoPorHora) || 0);
    const isHol = esFeriado === 'si' || esFeriado === true;
    const bonus = isHol ? Math.max(0, parseFloat(aumentoFeriado) || 0) : 0;

    const minutosTotales = (h * 60) + m;
    const horasDecimal = minutosTotales / 60;
    const pagoBase = horasDecimal * rate;
    const total = isHol ? (pagoBase + bonus) : pagoBase;

    return {
        horas: h,
        minutos: m,
        horasDecimal: horasDecimal,
        pagoPorHora: rate,
        pagoBase: pagoBase,
        esFeriado: isHol,
        aumentoFeriado: bonus,
        total: total
    };
}

// CÁLCULO Y ACTUALIZACIÓN EN VIVO DEL MINI REPORTE INDIVIDUAL
function calculateWorkerMiniReportLive() {
    const valInput = (document.getElementById('draft-worker-input').value || '').trim();
    const worker = appData.trabajadores.find(w => w.activo && (w.nombre.toLowerCase() === valInput.toLowerCase() || w.id === document.getElementById('draft-worker-id').value));
    
    const horas = document.getElementById('draft-horas').value;
    const minutos = document.getElementById('draft-minutos').value;
    const feriado = document.getElementById('draft-feriado').value;
    const aumento = document.getElementById('draft-aumento').value;

    const rate = worker ? worker.pagoPorHora : 0;
    const calc = computeSalaryValues(horas, minutos, rate, feriado, aumento);

    document.getElementById('mini-trabajador').textContent = worker ? worker.nombre : (valInput || '--');
    document.getElementById('mini-horas-str').textContent = `${calc.horas} h ${calc.minutos} min`;
    document.getElementById('mini-horas-decimal').textContent = `${calc.horasDecimal.toFixed(2)} h`;
    document.getElementById('mini-pago-hora').textContent = formatBs(calc.pagoPorHora);
    document.getElementById('mini-pago-base').textContent = formatBs(calc.pagoBase);
    document.getElementById('mini-feriado').textContent = calc.esFeriado ? 'Sí' : 'No';
    document.getElementById('mini-aumento').textContent = formatBs(calc.aumentoFeriado);
    document.getElementById('mini-total-pagar').textContent = formatBs(calc.total);
}

// AGREGAR TRABAJADOR AL REPORTE GENERAL
function handleAddWorkerToDraft(e) {
    e.preventDefault();

    const desde = document.getElementById('calc-desde').value;
    const hasta = document.getElementById('calc-hasta').value;
    const valInput = (document.getElementById('draft-worker-input').value || '').trim();
    const horas = document.getElementById('draft-horas').value;
    const minutos = document.getElementById('draft-minutos').value;
    const feriado = document.getElementById('draft-feriado').value;
    const aumento = document.getElementById('draft-aumento').value;

    if (!desde || !hasta) {
        showToast('Debes seleccionar las fechas del periodo (Desde y Hasta).', 'error');
        return;
    }

    if (new Date(desde) > new Date(hasta)) {
        showToast('La fecha "Desde" no puede ser posterior a la fecha "Hasta".', 'error');
        return;
    }

    const worker = appData.trabajadores.find(w => w.activo && (w.nombre.toLowerCase() === valInput.toLowerCase() || w.id === document.getElementById('draft-worker-id').value));
    
    if (!worker) {
        showToast(`El trabajador "${valInput}" no existe o está inactivo. Regístralo haciendo clic en "+ NUEVO TRABAJADOR".`, 'error');
        return;
    }

    // Verificar duplicados en el mismo reporte actual
    const yaExiste = currentDraftPayroll.trabajadores.some(item => item.workerId === worker.id);
    if (yaExiste) {
        showToast(`${worker.nombre} ya fue agregado a este reporte. Puedes editarlo abajo.`, 'error');
        return;
    }

    const calc = computeSalaryValues(horas, minutos, worker.pagoPorHora, feriado, aumento);

    const newItem = {
        workerId: worker.id,
        workerNombre: worker.nombre,
        horas: calc.horas,
        minutos: calc.minutos,
        horasDecimal: calc.horasDecimal,
        pagoPorHora: calc.pagoPorHora,
        pagoBase: calc.pagoBase,
        esFeriado: calc.esFeriado,
        aumentoFeriado: calc.aumentoFeriado,
        total: calc.total
    };

    currentDraftPayroll.trabajadores.push(newItem);

    renderDraftTable();
    showToast(`${worker.nombre} agregado al reporte.`, 'success');

    // LIMPIAR CAMPOS DE ENTRADA Y REINICIAR MINI REPORTE
    document.getElementById('draft-worker-input').value = '';
    document.getElementById('draft-worker-id').value = '';
    document.getElementById('draft-horas').value = '0';
    document.getElementById('draft-minutos').value = '0';
    document.getElementById('draft-feriado').value = 'no';
    document.getElementById('draft-aumento').value = '0.00';
    toggleDraftHolidayInput();
    calculateWorkerMiniReportLive();
}

function renderDraftTable() {
    const tbody = document.getElementById('draft-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = currentDraftPayroll.trabajadores;

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center" style="padding: 28px; color: var(--text-muted);">
                    No hay trabajadores agregados aún. Selecciona uno arriba y haz clic en "➕ AGREGAR AL CÁLCULO".
                </td>
            </tr>
        `;
        document.getElementById('draft-total-workers').textContent = '0';
        document.getElementById('draft-total-money').textContent = 'Bs 0.00';
        return;
    }

    let totalMoneySum = 0;

    list.forEach((item, index) => {
        totalMoneySum += item.total;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${index + 1}</strong></td>
            <td><strong>${escapeHtml(item.workerNombre)}</strong></td>
            <td>${item.horas} h ${item.minutos} min</td>
            <td>Bs ${formatNumber(item.pagoPorHora)}</td>
            <td>${item.esFeriado ? 'Sí' : 'No'}</td>
            <td>${formatBs(item.aumentoFeriado)}</td>
            <td><strong style="color:var(--primary-orange-dark); font-size:1.05rem;">${formatBs(item.total)}</strong></td>
            <td class="no-print">
                <div class="actions-cell">
                    <button class="btn btn-secondary btn-sm" onclick="viewDraftCalculation(${index})" title="Ver cálculo">
                        👁️ Ver
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="openEditDraftModal(${index})" title="Editar horas">
                        ✏️ Editar
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="removeDraftWorker(${index})" title="Quitar trabajador">
                        🗑️ Quitar
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('draft-total-workers').textContent = list.length;
    document.getElementById('draft-total-money').textContent = formatBs(totalMoneySum);
}

// Muestra el detalle de un trabajador añadido al cálculo sin cerrar ni alterar el borrador.
function viewDraftCalculation(index) {
    const item = currentDraftPayroll.trabajadores[index];
    if (!item) return;

    const container = document.getElementById('modal-view-draft-calculation-content');
    const periodoDesde = currentDraftPayroll.fechaDesde ? formatDateDisplay(currentDraftPayroll.fechaDesde) : '--/--/----';
    const periodoHasta = currentDraftPayroll.fechaHasta ? formatDateDisplay(currentDraftPayroll.fechaHasta) : '--/--/----';
    const tarifa = Number(item.pagoPorHora) || 0;
    const horasCalculadas = Number(item.horasDecimal) || 0;

    container.innerHTML = `
        <div class="report-view-detail">
            <div class="report-header-detail">
                <h2>${escapeHtml(item.workerNombre)}</h2>
                <h3>DETALLE DEL CÁLCULO</h3>
            </div>
            <div class="report-meta-grid">
                <div style="grid-column: span 2;"><strong>PERIODO:</strong> ${periodoDesde} AL ${periodoHasta}</div>
                <div><strong>HORAS REGISTRADAS:</strong> ${item.horas} h ${item.minutos} min</div>
                <div><strong>HORAS CALCULADAS:</strong> ${formatNumber(horasCalculadas)} h</div>
                <div><strong>PAGO POR HORA:</strong> ${formatBs(tarifa)}</div>
                <div><strong>PAGO BASE:</strong> ${formatBs(item.pagoBase)}</div>
                <div><strong>¿FERIADO?:</strong> ${item.esFeriado ? 'Sí' : 'No'}</div>
                <div><strong>AUMENTO POR FERIADO:</strong> ${formatBs(item.aumentoFeriado)}</div>
            </div>
            <div class="total-general-banner margin-top">
                <div class="total-stat-item highlight" style="width:100%;">
                    <span class="stat-title">TOTAL A PAGAR</span>
                    <span class="stat-money">${formatBs(item.total)}</span>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal-view-draft-calculation').classList.add('active');
}

function closeDraftCalculationModal() {
    document.getElementById('modal-view-draft-calculation').classList.remove('active');
}

function removeDraftWorker(index) {
    if (index >= 0 && index < currentDraftPayroll.trabajadores.length) {
        const item = currentDraftPayroll.trabajadores[index];
        currentDraftPayroll.trabajadores.splice(index, 1);
        renderDraftTable();
        showToast(`${item.workerNombre} quitado del reporte.`, 'success');
    }
}

function openEditDraftModal(index) {
    const item = currentDraftPayroll.trabajadores[index];
    if (!item) return;

    document.getElementById('edit-draft-index').value = index;
    document.getElementById('edit-draft-nombre').value = item.workerNombre;
    document.getElementById('edit-draft-horas').value = item.horas;
    document.getElementById('edit-draft-minutos').value = item.minutos;
    document.getElementById('edit-draft-feriado').value = item.esFeriado ? 'si' : 'no';
    document.getElementById('edit-draft-aumento').value = item.aumentoFeriado || 0;

    toggleEditDraftHolidayInput();
    document.getElementById('modal-edit-draft-item').classList.add('active');
}

function closeEditDraftModal() {
    document.getElementById('modal-edit-draft-item').classList.remove('active');
}

function toggleEditDraftHolidayInput() {
    const isHoliday = document.getElementById('edit-draft-feriado').value === 'si';
    const group = document.getElementById('group-edit-draft-aumento');
    if (group) group.style.display = isHoliday ? 'block' : 'none';
}

function handleSaveEditDraftItem(e) {
    e.preventDefault();
    const index = parseInt(document.getElementById('edit-draft-index').value, 10);
    const item = currentDraftPayroll.trabajadores[index];
    if (!item) return;

    const horas = document.getElementById('edit-draft-horas').value;
    const minutos = document.getElementById('edit-draft-minutos').value;
    const feriado = document.getElementById('edit-draft-feriado').value;
    const aumento = document.getElementById('edit-draft-aumento').value;

    const calc = computeSalaryValues(horas, minutos, item.pagoPorHora, feriado, aumento);

    item.horas = calc.horas;
    item.minutos = calc.minutos;
    item.horasDecimal = calc.horasDecimal;
    item.pagoBase = calc.pagoBase;
    item.esFeriado = calc.esFeriado;
    item.aumentoFeriado = calc.aumentoFeriado;
    item.total = calc.total;

    closeEditDraftModal();
    renderDraftTable();
    showToast(`Datos de ${item.workerNombre} actualizados.`, 'success');
}

// GUARDAR REPORTE FINAL DEL PAGO
function saveFinalPayrollReport() {
    if (currentDraftPayroll.trabajadores.length === 0) {
        showToast('Debes agregar al menos un trabajador al cálculo antes de guardar el reporte.', 'error');
        return;
    }

    const desde = document.getElementById('calc-desde').value;
    const hasta = document.getElementById('calc-hasta').value;
    const hoyStr = getFechaHoyString();

    if (!desde || !hasta) {
        showToast('Verifica que las fechas del periodo (Desde / Hasta) estén seleccionadas.', 'error');
        return;
    }

    const totalGeneralSum = currentDraftPayroll.trabajadores.reduce((acc, item) => acc + item.total, 0);

    showConfirmModal(
        'Confirmar Guardado de Reporte',
        `¿Está seguro de guardar este reporte de pago por un total de ${formatBs(totalGeneralSum)} con ${currentDraftPayroll.trabajadores.length} trabajadores?`,
        () => {
            const now = new Date();
            const fechaCreacionStr = formatDateDisplay(hoyStr);
            const horaCreacionStr = now.toTimeString().slice(0, 5);

            const reportObj = {
                id: 'rep_' + Date.now(),
                fechaDesde: desde,
                fechaHasta: hasta,
                fechaPago: hoyStr,
                fechaHoraCreacion: `${fechaCreacionStr} - ${horaCreacionStr}`,
                // Se guarda una instantánea completa: cambios futuros en la tarifa
                // del trabajador no modifican ningún pago ya registrado.
                trabajadores: currentDraftPayroll.trabajadores.map(item => ({
                    ...JSON.parse(JSON.stringify(item)),
                    pagoPorHoraRegistrado: item.pagoPorHora
                })),
                cantidadTrabajadores: currentDraftPayroll.trabajadores.length,
                totalGeneral: totalGeneralSum
            };

            appData.reportesGuardados.push(reportObj);
            guardarDatos();

            showToast('REPORTE GUARDADO CORRECTAMENTE', 'success');

            // LIMPIAR PANTALLA DE CÁLCULO
            currentDraftPayroll.trabajadores = [];
            renderDraftTable();

            document.getElementById('draft-worker-input').value = '';
            document.getElementById('draft-worker-id').value = '';
            document.getElementById('draft-horas').value = '0';
            document.getElementById('draft-minutos').value = '0';
            document.getElementById('draft-feriado').value = 'no';
            document.getElementById('draft-aumento').value = '0.00';
            toggleDraftHolidayInput();
            calculateWorkerMiniReportLive();

            renderSavedReportsList();
        }
    );
}

// ==========================================================================
// 4. GESTIÓN DE TRABAJADORES (ADMIN)
// ==========================================================================

function renderWorkers() {
    const tbody = document.getElementById('workers-table-body');
    const searchVal = (document.getElementById('search-worker').value || '').toLowerCase().trim();
    const statusFilter = document.getElementById('filter-worker-status').value;

    if (!tbody) return;
    tbody.innerHTML = '';

    const list = appData.trabajadores.filter(w => {
        const matchName = w.nombre.toLowerCase().includes(searchVal);
        const matchStatus = (statusFilter === 'todos') ||
                            (statusFilter === 'activo' && w.activo) ||
                            (statusFilter === 'inactivo' && !w.activo);
        return matchName && matchStatus;
    });

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center" style="padding: 24px; color: var(--text-muted);">
                    No se encontraron trabajadores registrados.
                </td>
            </tr>
        `;
        return;
    }

    list.forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${w.id}</strong></td>
            <td><strong>${escapeHtml(w.nombre)}</strong></td>
            <td>Bs ${formatNumber(w.pagoPorHora)} / h</td>
            <td>
                <span class="status-badge ${w.activo ? 'activo' : 'inactivo'}">
                    ${w.activo ? 'Activo' : 'Inactivo'}
                </span>
            </td>
            <td>
                <div class="actions-cell">
                    <button class="btn btn-secondary btn-sm" onclick="viewWorkerPaymentHistory('${w.id}')" title="Ver pagos registrados">
                        👁️ Ver pagos
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="openWorkerModal('${w.id}')" title="Editar trabajador">
                        ✏️ Editar
                    </button>
                    <button class="btn ${w.activo ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleWorkerStatus('${w.id}')">
                        ${w.activo ? '🚫 Desactivar' : '✅ Activar'}
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteWorker('${w.id}')" title="Eliminar trabajador permanentemente">
                        🗑️ Eliminar
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Consulta los pagos ya guardados de un trabajador. La tarifa mostrada proviene
// de la instantánea del reporte, nunca de la tarifa actual del trabajador.
function viewWorkerPaymentHistory(workerId) {
    const worker = appData.trabajadores.find(w => w.id === workerId);
    if (!worker) return;

    const payments = appData.reportesGuardados
        .flatMap(report => (report.trabajadores || [])
            .filter(item => item.workerId === workerId || item.workerNombre === worker.nombre)
            .map(item => ({ report, item })))
        .sort((a, b) => String(b.report.fechaPago || '').localeCompare(String(a.report.fechaPago || '')));

    document.getElementById('worker-payment-history-title').textContent = `👁️ Pagos de ${worker.nombre}`;
    const container = document.getElementById('worker-payment-history-content');

    if (payments.length === 0) {
        container.innerHTML = `
            <div class="card text-center" style="padding: 28px; color: var(--text-muted);">
                <h3>Aún no hay pagos guardados para ${escapeHtml(worker.nombre)}.</h3>
                <p>Cuando se guarde un reporte que incluya a este trabajador, aparecerá aquí.</p>
            </div>
        `;
    } else {
        const totalPaid = payments.reduce((sum, payment) => sum + (Number(payment.item.total) || 0), 0);
        container.innerHTML = `
            <p class="form-help" style="margin-top:0; margin-bottom:16px;">Cada fila conserva la tarifa usada al registrar ese pago, aunque la tarifa actual cambie después.</p>
            <table class="report-table-print">
                <thead>
                    <tr>
                        <th>Periodo</th>
                        <th>Fecha de pago</th>
                        <th>Horas</th>
                        <th>Tarifa registrada</th>
                        <th>Total pagado</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments.map(({ report, item }) => `
                        <tr>
                            <td>${formatDateDisplay(report.fechaDesde)} al ${formatDateDisplay(report.fechaHasta)}</td>
                            <td>${formatDateDisplay(report.fechaPago)}</td>
                            <td>${item.horas} h ${item.minutos} min</td>
                            <td>Bs ${formatNumber(item.pagoPorHoraRegistrado ?? item.pagoPorHora)}</td>
                            <td><strong>${formatBs(item.total)}</strong></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="report-summary-footer-print">
                <div><strong>Pagos registrados:</strong> ${payments.length}</div>
                <div style="font-size:1.2rem; font-weight:900; color:var(--primary-orange-dark);">TOTAL PAGADO: ${formatBs(totalPaid)}</div>
            </div>
        `;
    }

    document.getElementById('modal-worker-payment-history').classList.add('active');
}

function closeWorkerPaymentHistoryModal() {
    document.getElementById('modal-worker-payment-history').classList.remove('active');
}

function deleteWorker(workerId) {
    const worker = appData.trabajadores.find(w => w.id === workerId);
    if (!worker) return;

    showConfirmModal(
        'Confirmar Eliminación',
        `¿Está seguro de eliminar permanentemente a ${worker.nombre}?`,
        () => {
            appData.trabajadores = appData.trabajadores.filter(w => w.id !== workerId);
            sanearIdsTrabajadores(true);
            guardarDatos();
            renderWorkers();
            populateWorkersDatalist();
            showToast(`Trabajador ${worker.nombre} eliminado.`, 'success');
        }
    );
}

function openWorkerModal(workerId = null, fromSalaryForm = false) {
    const modal = document.getElementById('modal-worker');
    const title = document.getElementById('modal-worker-title');
    const idInput = document.getElementById('work-id');
    const nombreInput = document.getElementById('work-nombre');
    const pagoInput = document.getElementById('work-pago');
    const estadoSelect = document.getElementById('work-estado');

    document.getElementById('form-worker').reset();

    if (workerId) {
        const worker = appData.trabajadores.find(w => w.id === workerId);
        if (worker) {
            title.textContent = '✏️ Editar Trabajador';
            idInput.value = worker.id;
            nombreInput.value = worker.nombre;
            pagoInput.value = worker.pagoPorHora;
            estadoSelect.value = worker.activo ? 'true' : 'false';
        }
    } else {
        title.textContent = '➕ Registrar Nuevo Trabajador';
        idInput.value = '';
        estadoSelect.value = 'true';
    }

    modal.setAttribute('data-from-salary', fromSalaryForm ? 'true' : 'false');
    modal.classList.add('active');
}

function closeWorkerModal() {
    document.getElementById('modal-worker').classList.remove('active');
}

function handleWorkerSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('work-id').value;
    const nombre = document.getElementById('work-nombre').value.trim();
    const pagoPorHora = parseFloat(document.getElementById('work-pago').value);
    const activo = document.getElementById('work-estado').value === 'true';
    const fromSalaryForm = document.getElementById('modal-worker').getAttribute('data-from-salary') === 'true';

    if (!nombre) {
        showToast('El nombre no puede estar vacío.', 'error');
        return;
    }

    if (isNaN(pagoPorHora) || pagoPorHora <= 0) {
        showToast('El pago por hora asignado debe ser mayor a 0.', 'error');
        return;
    }

    if (id) {
        const worker = appData.trabajadores.find(w => w.id === id);
        if (worker) {
            worker.nombre = nombre;
            worker.pagoPorHora = pagoPorHora;
            worker.activo = activo;
            guardarDatos();
            showToast('Trabajador actualizado.', 'success');
        }
    } else {
        const newWorker = {
            id: obtenerSiguienteIdTrabajador(),
            nombre: nombre,
            pagoPorHora: pagoPorHora,
            activo: activo,
            fechaRegistro: getFechaHoyString()
        };
        appData.trabajadores.push(newWorker);
        guardarDatos();
        showToast('Trabajador registrado correctamente.', 'success');

        if (fromSalaryForm) {
            populateWorkersDatalist();
            document.getElementById('draft-worker-input').value = newWorker.nombre;
            document.getElementById('draft-worker-id').value = newWorker.id;
            calculateWorkerMiniReportLive();
        }
    }

    closeWorkerModal();
    renderWorkers();
    populateWorkersDatalist();
}

function toggleWorkerStatus(workerId) {
    const worker = appData.trabajadores.find(w => w.id === workerId);
    if (!worker) return;

    const targetStatus = !worker.activo;
    showConfirmModal(
        'Confirmar Cambio de Estado',
        `¿Está seguro de ${targetStatus ? 'activar' : 'desactivar'} a ${worker.nombre}?`,
        () => {
            worker.activo = targetStatus;
            guardarDatos();
            renderWorkers();
            populateWorkersDatalist();
            showToast(`Trabajador ${worker.nombre} ${targetStatus ? 'activado' : 'desactivado'}.`, 'success');
        }
    );
}

// ==========================================================================
// 5. REPORTES GUARDADOS
// ==========================================================================

function renderSavedReportsList() {
    const container = document.getElementById('saved-reports-container');
    if (!container) return;
    container.innerHTML = '';

    if (appData.reportesGuardados.length === 0) {
        container.innerHTML = `
            <div class="card text-center" style="padding: 40px; color: var(--text-muted);">
                <h3>No hay reportes de pagos guardados aún.</h3>
                <p>Ve a "REALIZAR CÁLCULO" para generar y guardar el primer reporte de pago.</p>
            </div>
        `;
        return;
    }

    const list = [...appData.reportesGuardados].reverse();

    list.forEach(rep => {
        const card = document.createElement('div');
        card.className = 'report-summary-card';
        card.innerHTML = `
            <div class="report-summary-main">
                <h3>📅 Fecha de Pago: ${formatDateDisplay(rep.fechaPago)}</h3>
                <p><strong>PERIODO DE PAGO:</strong> ${formatDateDisplay(rep.fechaDesde)} AL ${formatDateDisplay(rep.fechaHasta)}</p>
                <p><small style="color:#777">Guardado el: ${rep.fechaHoraCreacion}</small></p>
            </div>
            <div class="report-summary-stats">
                <div class="rep-stat-box">
                    <span class="rep-stat-label">Trabajadores</span>
                    <span class="rep-stat-val" style="color:var(--text-dark);">${rep.cantidadTrabajadores}</span>
                </div>
                <div class="rep-stat-box">
                    <span class="rep-stat-label">Total Pagado</span>
                    <span class="rep-stat-val">${formatBs(rep.totalGeneral)}</span>
                </div>
                <div class="actions-cell">
                    <button class="btn btn-primary btn-sm" onclick="viewSavedReport('${rep.id}')">
                        🔍 VER REPORTE
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteSavedReport('${rep.id}')" title="Eliminar reporte guardado">
                        🗑️
                    </button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function viewSavedReport(reportId) {
    const rep = appData.reportesGuardados.find(r => r.id === reportId);
    if (!rep) return;

    const container = document.getElementById('modal-view-report-content');
    container.innerHTML = `
        <div class="report-view-detail" id="printable-report-detail">
            <div class="report-header-detail">
                <h2>🌴 TROPICAL GRILL</h2>
                <h3>REPORTE DE SALARIOS</h3>
            </div>

            <div class="report-meta-grid">
                <div><strong>PERIODO DE PAGO:</strong> ${formatDateDisplay(rep.fechaDesde)} AL ${formatDateDisplay(rep.fechaHasta)}</div>
                <div><strong>FECHA DE PAGO:</strong> ${formatDateDisplay(rep.fechaPago)}</div>
                <div style="grid-column: span 2;"><strong>FECHA Y HORA DE CREACIÓN:</strong> ${rep.fechaHoraCreacion}</div>
            </div>

            <table class="report-table-print" style="margin-top:20px;">
                <thead>
                    <tr>
                        <th>N°</th>
                        <th>Trabajador</th>
                        <th>Horas</th>
                        <th>Pago por Hora</th>
                        <th>Feriado</th>
                        <th>Aumento</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rep.trabajadores.map((t, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td><strong>${escapeHtml(t.workerNombre)}</strong></td>
                            <td>${t.horas} h ${t.minutos} min</td>
                            <td>Bs ${formatNumber(t.pagoPorHoraRegistrado ?? t.pagoPorHora)}</td>
                            <td>${t.esFeriado ? 'Sí' : 'No'}</td>
                            <td>${formatBs(t.aumentoFeriado)}</td>
                            <td><strong>${formatBs(t.total)}</strong></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="report-summary-footer-print">
                <div><strong>Cantidad de trabajadores:</strong> ${rep.cantidadTrabajadores}</div>
                <div style="font-size:1.3rem; font-weight:900; color:var(--primary-orange-dark);">
                    TOTAL GENERAL PAGADO: ${formatBs(rep.totalGeneral)}
                </div>
            </div>
        </div>
    `;

    document.getElementById('btn-print-view-report').onclick = () => {
        const printContainer = document.getElementById('print-only-container');
        printContainer.innerHTML = container.innerHTML;
        window.print();
    };

    document.getElementById('modal-view-report').classList.add('active');
}

function closeViewReportModal() {
    document.getElementById('modal-view-report').classList.remove('active');
}

function deleteSavedReport(reportId) {
    const rep = appData.reportesGuardados.find(r => r.id === reportId);
    if (!rep) return;

    showConfirmModal(
        'Confirmar Eliminación',
        `¿Está seguro de eliminar el reporte guardado del periodo ${formatDateDisplay(rep.fechaDesde)} al ${formatDateDisplay(rep.fechaHasta)}?`,
        () => {
            appData.reportesGuardados = appData.reportesGuardados.filter(r => r.id !== reportId);
            guardarDatos();
            renderSavedReportsList();
            showToast('Reporte eliminado.', 'success');
        }
    );
}

// ==========================================================================
// 6. MODALES Y NOTIFICACIONES
// ==========================================================================

function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('modal-confirm');
    document.getElementById('confirm-modal-title').textContent = title || 'Confirmación';
    document.getElementById('confirm-modal-message').textContent = message || '¿Desea continuar?';

    pendingConfirmCallback = onConfirm;

    const okBtn = document.getElementById('confirm-btn-ok');
    okBtn.onclick = () => {
        closeConfirmModal(true);
    };

    modal.classList.add('active');
}

function closeConfirmModal(confirmed = false) {
    const modal = document.getElementById('modal-confirm');
    modal.classList.remove('active');

    if (confirmed && typeof pendingConfirmCallback === 'function') {
        pendingConfirmCallback();
    }
    pendingConfirmCallback = null;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${type === 'success' ? '✅' : '⚠️'}</span>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 300);
    }, 3500);
}

// ==========================================================================
// 7. FUNCIONES UTILITARIAS Y FORMATO
// ==========================================================================

function getFechaHoyString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateDisplay(fechaStr) {
    if (!fechaStr) return '';
    const parts = fechaStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return fechaStr;
}

function formatBs(amount) {
    const val = parseFloat(amount) || 0;
    return `Bs ${val.toFixed(2)}`;
}

function formatNumber(amount) {
    const val = parseFloat(amount) || 0;
    return val.toFixed(2);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
