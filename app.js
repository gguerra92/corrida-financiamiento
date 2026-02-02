/* ===== Helpers ===== */
const fmtMXN = (n) => new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(n || 0);
const fmtPct = (n) => `${(n || 0).toFixed(2)}%`;

function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }

function addMonths(date, months){
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Ajuste si el mes resultante no tiene ese día
  if (d.getDate() < day) d.setDate(0);
  return d;
}

function formatDateISO(d){
  const dd = new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth()+1).padStart(2,'0');
  const day = String(dd.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function formatDateHuman(d){
  const dd = new Date(d);
  return dd.toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'2-digit' });
}

// PMT (pago por periodo) sobre monto sin IVA
function pmt(rate, nper, pv){
  if (nper <= 0) return 0;
  if (rate === 0) return pv / nper;
  return (pv * rate) / (1 - Math.pow(1 + rate, -nper));
}

/* ===== UI refs ===== */
const $ = (id) => document.getElementById(id);

const ui = {
  cliente: $('cliente'),
  total: $('total'),
  enganchePct: $('enganchePct'),
  engancheMonto: $('engancheMonto'),
  tasaAnual: $('tasaAnual'),
  meses: $('meses'),
  primerPago: $('primerPago'),
  ivaPct: $('ivaPct'),
  ivaModo: $('ivaModo'),
  diasPeriodo: $('diasPeriodo'),
  btnCalcular: $('btnCalcular'),
  btnLimpiar: $('btnLimpiar'),
  btnPDF: $('btnPDF'),
  tablaBody: document.querySelector('#tabla tbody'),

  resSubtotal: $('resSubtotal'),
  resIva: $('resIva'),
  resEnganche: $('resEnganche'),
  resFinanciar: $('resFinanciar'),
  resMensualidad: $('resMensualidad'),
  resTotalFin: $('resTotalFin'),
};

let lastResult = null;

/* ===== Defaults ===== */
(function init(){
  // fecha default: hoy + 30
  const today = new Date();
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() + 30);
  ui.primerPago.value = formatDateISO(d);

  ui.btnCalcular.addEventListener('click', (e) => { e.preventDefault(); calcular(); });
  ui.btnLimpiar.addEventListener('click', (e) => { e.preventDefault(); limpiar(); });
  ui.btnPDF.addEventListener('click', (e) => { e.preventDefault(); generarPDF(); });

  // Si editan enganche monto, recalculamos % visualmente (al calcular)
})();

/* ===== Core ===== */
function getInputs(){
  const total = Number(ui.total.value || 0);
  const engPct = Number(ui.enganchePct.value || 0) / 100;
  const engMonto = Number(ui.engancheMonto.value || 0);
  const tasaAnual = Number(ui.tasaAnual.value || 0) / 100;
  const meses = parseInt(ui.meses.value || '0', 10);
  const primerPago = ui.primerPago.value ? new Date(ui.primerPago.value) : new Date();
  const ivaRate = Number(ui.ivaPct.value || 16) / 100;
  const ivaModo = ui.ivaModo.value; // total | interes
  const diasPeriodo = parseInt(ui.diasPeriodo.value || '30', 10);
  const cliente = (ui.cliente.value || '').trim();

  return { total, engPct, engMonto, tasaAnual, meses, primerPago, ivaRate, ivaModo, diasPeriodo, cliente };
}

function validar(inp){
  const errs = [];
  if (!(inp.total > 0)) errs.push('Captura un monto total mayor a 0.');
  if (!(inp.meses > 0)) errs.push('Captura meses (mayor a 0).');
  if (inp.ivaRate < 0) errs.push('IVA inválido.');
  if (inp.tasaAnual < 0) errs.push('Tasa anual inválida.');
  if (inp.diasPeriodo < 1 || inp.diasPeriodo > 31) errs.push('Días por periodo debe estar entre 1 y 31.');
  if (inp.engMonto < 0) errs.push('Enganche inválido.');
  if (inp.engPct < 0) errs.push('% enganche inválido.');
  return errs;
}

function calcular(){
  const inp = getInputs();
  const errs = validar(inp);
  if (errs.length){
    alert(errs.join('\n'));
    return;
  }

  // Enganche: si hay monto, manda. Si no, usa porcentaje
  let engancheIncl = inp.engMonto > 0 ? inp.engMonto : inp.total * inp.engPct;
  engancheIncl = Math.min(engancheIncl, inp.total);
  engancheIncl = round2(engancheIncl);

  // Recalcular % enganche para que se “alinee” visualmente
  const enganchePctReal = inp.total > 0 ? (engancheIncl / inp.total) : 0;
  ui.enganchePct.value = (enganchePctReal * 100).toFixed(2);

  const subtotalTotal = round2(inp.total / (1 + inp.ivaRate));
  const ivaTotal = round2(inp.total - subtotalTotal);

  const financiarIncl = round2(inp.total - engancheIncl);
  const financiarSub = round2(financiarIncl / (1 + inp.ivaRate));

  // Tasa periodo por base 360: (tasaAnual/360) * diasPeriodo
  const rate = round2((inp.tasaAnual / 360) * inp.diasPeriodo);

  // Pago por periodo (sin IVA)
  let pagoSub = pmt(rate, inp.meses, financiarSub);
  pagoSub = round2(pagoSub);

  // Armado de corrida
  let saldo = financiarSub;
  const rows = [];
  let totalPagos = 0;

  for (let k = 1; k <= inp.meses; k++){
    const fecha = addMonths(inp.primerPago, k - 1);

    let interes = round2(saldo * rate);
    let capital = round2(pagoSub - interes);

    // Ajuste último pago para cerrar saldo por redondeos
    let saldoFinal = round2(saldo - capital);
    if (k === inp.meses){
      capital = round2(capital + saldoFinal); // si saldoFinal quedó positivo/negativo, lo absorbe
      saldoFinal = 0;
      // Recalcula pagoSub para el último si quieres que se vea exacto:
      // pagoSub = round2(capital + interes);
    }

    const baseIVA = (inp.ivaModo === 'interes') ? interes : (capital + interes);
    const ivaPago = round2(baseIVA * inp.ivaRate);
    const pagoTotal = round2(capital + interes + ivaPago);

    rows.push({
      n: k,
      fecha,
      saldoInicial: saldo,
      capital,
      interes,
      iva: ivaPago,
      pago: pagoTotal,
      saldoFinal
    });

    totalPagos = round2(totalPagos + pagoTotal);
    saldo = saldoFinal;
  }

  // Mensualidad aproximada: primer pago
  const mensualidad = rows.length ? rows[0].pago : 0;

  lastResult = {
    ...inp,
    engancheIncl,
    enganchePctReal,
    subtotalTotal,
    ivaTotal,
    financiarIncl,
    financiarSub,
    rate,
    pagoSub,
    mensualidad,
    totalPagos,
    rows
  };

  render(lastResult);
}

function render(res){
  // resumen
  ui.resSubtotal.textContent = fmtMXN(res.subtotalTotal);
  ui.resIva.textContent = fmtMXN(res.ivaTotal);
  ui.resEnganche.textContent = `${fmtMXN(res.engancheIncl)} (${fmtPct(res.enganchePctReal*100)})`;
  ui.resFinanciar.textContent = fmtMXN(res.financiarIncl);
  ui.resMensualidad.textContent = fmtMXN(res.mensualidad);
  ui.resTotalFin.textContent = fmtMXN(res.totalPagos);

  // tabla
  ui.tablaBody.innerHTML = '';
  for (const r of res.rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.n}</td>
      <td>${formatDateHuman(r.fecha)}</td>
      <td>${fmtMXN(r.saldoInicial)}</td>
      <td>${fmtMXN(r.capital)}</td>
      <td>${fmtMXN(r.interes)}</td>
      <td>${fmtMXN(r.iva)}</td>
      <td><strong>${fmtMXN(r.pago)}</strong></td>
      <td>${fmtMXN(r.saldoFinal)}</td>
    `;
    ui.tablaBody.appendChild(tr);
  }

  ui.btnPDF.disabled = false;
}

function limpiar(){
  ui.cliente.value = '';
  ui.total.value = '';
  ui.enganchePct.value = '';
  ui.engancheMonto.value = '';
  ui.tasaAnual.value = '';
  ui.meses.value = '';
  ui.ivaPct.value = '16';
  ui.ivaModo.value = 'total';
  ui.diasPeriodo.value = '30';
  ui.tablaBody.innerHTML = '';
  ui.btnPDF.disabled = true;

  ui.resSubtotal.textContent = '—';
  ui.resIva.textContent = '—';
  ui.resEnganche.textContent = '—';
  ui.resFinanciar.textContent = '—';
  ui.resMensualidad.textContent = '—';
  ui.resTotalFin.textContent = '—';

  lastResult = null;
}

/* ===== PDF ===== */
function generarPDF(){
  if (!lastResult) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'letter' });

  const company = 'Jardines de Juan Pablo'; // cámbialo si quieres
  const titulo = 'CORRIDA DE FINANCIAMIENTO';
  const cliente = lastResult.cliente || '—';

  const left = 40;
  let y = 48;

  doc.setFont('helvetica','bold');
  doc.setFontSize(14);
  doc.text(company, left, y);

  doc.setFontSize(12);
  doc.text(titulo, left, y + 18);

  doc.setFont('helvetica','normal');
  doc.setFontSize(10);

  y += 42;

  const ivaModoTxt = lastResult.ivaModo === 'interes'
    ? 'IVA sobre interés'
    : 'IVA sobre (capital + interés)';

  const lines = [
    `Cliente: ${cliente}`,
    `Monto total (con IVA): ${fmtMXN(lastResult.total)}`,
    `Enganche: ${fmtMXN(lastResult.engancheIncl)} (${fmtPct(lastResult.enganchePctReal*100)})`,
    `Monto a financiar (con IVA): ${fmtMXN(lastResult.financiarIncl)}`,
    `Monto a financiar (sin IVA): ${fmtMXN(lastResult.financiarSub)}`,
    `Tasa anual: ${fmtPct(lastResult.tasaAnual*100)}  ·  Días/periodo: ${lastResult.diasPeriodo} (base 360)`,
    `Meses: ${lastResult.meses}  ·  Primer pago: ${formatDateHuman(lastResult.primerPago)}`,
    `IVA: ${fmtPct(lastResult.ivaRate*100)}  ·  Modo: ${ivaModoTxt}`,
    `Mensualidad aprox.: ${fmtMXN(lastResult.mensualidad)}`,
    `Monto final financiado (suma de pagos): ${fmtMXN(lastResult.totalPagos)}`
  ];

  for (const ln of lines){
    doc.text(ln, left, y);
    y += 14;
  }

  y += 8;

  // Tabla
  const head = [[
    '#','Fecha','Saldo inicial (sin IVA)','Abono capital','Interés','IVA','Pago','Saldo final'
  ]];

  const body = lastResult.rows.map(r => ([
    String(r.n),
    formatDateHuman(r.fecha),
    fmtMXN(r.saldoInicial),
    fmtMXN(r.capital),
    fmtMXN(r.interes),
    fmtMXN(r.iva),
    fmtMXN(r.pago),
    fmtMXN(r.saldoFinal)
  ]));

  doc.autoTable({
    startY: y,
    head,
    body,
    styles: { font:'helvetica', fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [20,20,20] },
    theme: 'grid',
    margin: { left, right: 40 }
  });

  const safeCliente = (lastResult.cliente || 'cliente').replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'_');
  const fname = `Corrida_${safeCliente}_${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(fname);
}

/* ===== PWA ===== */
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
