// Panel de la cadena de conformidad.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const NOMBRES = {
  cubierto: 'cubierto',
  revocado: 'revocado',
  vencido: 'vencido',
  sin_cobertura: 'sin cobertura',
};

const ORDEN = ['revocado', 'vencido', 'sin_cobertura', 'cubierto'];

async function pedir(ruta) {
  const r = await fetch(ruta);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function cargar() {
  const d = await pedir('/api/informe');

  pintarIntegridad(d);
  pintarTarjetas(d.conteo);
  pintarFilas(d);
  pintarConsents(d);
}

function pintarIntegridad(d) {
  const pilchas = [];
  pilchas.push(`<span class="pill ${d.integridad.ok ? 'ok' : 'mal'}">cadena ${d.integridad.ok ? 'íntegra' : 'rota'} · ${d.integridad.total} eventos</span>`);
  pilchas.push(`<span class="pill ${d.anclaje.ok ? 'ok' : 'mal'}">anclaje ${d.anclaje.ok ? 'verificado' : 'sin verificar'}</span>`);
  pilchas.push(`<span class="pill ${d.comprobacion_externa.ok ? 'ok' : 'mal'}">publicación externa ${d.comprobacion_externa.ok ? 'coincide' : 'difiere'}</span>`);
  $('#integridad').innerHTML = pilchas.join('');

  const avisos = [];

  if (d.integridad.ok) {
    avisos.push(`<div class="aviso ok"><strong>La cadena está íntegra.</strong>
      ${d.integridad.total} eventos enlazados uno a uno: cada hash depende del anterior.
      Editar cualquiera obliga a recalcular todo lo que viene después.</div>`);
  } else {
    avisos.push(`<div class="aviso mal"><strong>La cadena está rota en el seq ${d.integridad.rotura?.seq}.</strong>
      Motivo: ${esc(d.integridad.rotura?.motivo)}. ${esc(d.integridad.rotura?.detalle)}</div>`);
  }

  // El anclaje es la diferencia entre "detectamos una edición" y "detectamos
  // una reescritura entera". Sin él, decir que la cadena es segura no sería
  // cierto: el dueño de la base puede rehacerla entera y quedaría coherente.
  if (d.anclaje.ok) {
    avisos.push(`<div class="aviso ok"><strong>La cabeza anclada sigue siendo la misma.</strong>
      Secuencia ${d.anclaje_local.seq}, hash <code>${esc(d.anclaje_local.head_hash.slice(0, 16))}…</code>.
      Alguien que hubiera borrado eventos y recalculado la cadena entera ya no
      coincidiría con lo que se publicó afuera.</div>`);
  } else {
    avisos.push(`<div class="aviso mal"><strong>Sin anclaje verificable.</strong> ${esc(d.anclaje.motivo)}</div>`);
  }

  avisos.push(`<div class="aviso info"><strong>Esto no es una firma electrónica acreditada.</strong>
    Es Ed25519 sobre un manifiesto: prueba que el manifiesto no cambió desde que se
    emitió. No prueba quién es el emisor ante un tercero ni cumple la Ley 19.800.</div>`);

  $('#integridad-detalle').innerHTML = avisos.join('');
}

function pintarTarjetas(c) {
  const tarjetas = [
    ['total', 'Envíos salientes', c.total],
    ['cubierto', 'Cubiertos', c.cubierto],
    ['revocado', 'Revocados', c.revocado],
    ['vencido', 'Vencidos', c.vencido],
    ['sin', 'Sin cobertura', c.sin_cobertura],
  ];
  $('#tarjetas').innerHTML = tarjetas.map(([clase, nombre, n]) => `
    <div class="tarjeta ${clase}">
      <b>${n}</b><span>${esc(nombre)}</span>
    </div>`).join('');
}

function pintarFilas(d) {
  const accionable = new Set(d.accionable);
  // Lo accionable primero: es lo que hay que mirar. Lo cubierto al final, que
  // es el ruido de fondo sano.
  const filas = [...d.filas].sort((a, b) => {
    const pa = accionable.has(a.seq) ? 0 : 1;
    const pb = accionable.has(b.seq) ? 0 : 1;
    return pa - pb || ORDEN.indexOf(a.veredicto) - ORDEN.indexOf(b.veredicto) || a.seq - b.seq;
  });

  $('#filas').innerHTML = filas.map((f) => {
    const clase = f.veredicto;
    const tipos = (f.tipos || []).map((t) => `<span class="seg">${esc(t)}</span>`).join(' ');

    const recibo = f.recibo
      ? `<div class="detalle-recibo">
           recibo <b>${esc(f.recibo.id.slice(0, 8))}</b> ·
           texto <b>${esc(f.recibo.texto_sha256.slice(0, 16))}…</b> ·
           ${f.recibo.caracteres_enviados} de ${f.recibo.caracteres_originales} caracteres ·
           llave ${esc(f.recibo.kid)} ·
           firma ${f.recibo.verificacion.ok ? '<b>válida</b>' : '<b>INVÁLIDA</b> — ' + esc(f.recibo.verificacion.motivo)}
         </div>`
      : '<div class="detalle-recibo">sin recibo: el texto no salió hacia ningún proveedor</div>';

    return `<div class="fila ${clase}">
      <div class="fila-cabecera">
        <span class="seq">seq ${f.seq} · ${esc(f.ts.slice(0, 16).replace('T', ' '))} · ${esc(f.proposito)}${f.consentimiento ? ' · ' + esc(f.consentimiento) : ' · sin consentimiento'}</span>
        <span class="etiqueta ${clase}">${esc(NOMBRES[clase] || clase)}</span>
      </div>
      <p class="texto">
        <span class="orig">${esc(f.texto)}</span>
        ${tipos ? `<br><span class="seg" style="background:none;color:#77839a">salió como →</span> ${tipos}` : ''}
      </p>
      <p class="motivo ${clase}">${esc(f.motivo)}</p>
      ${recibo}
    </div>`;
  }).join('');
}

function pintarConsents(d) {
  const accionesPorConsent = new Map();
  for (const a of d.acciones) {
    if (!accionesPorConsent.has(a.consent_id)) accionesPorConsent.set(a.consent_id, []);
    accionesPorConsent.get(a.consent_id).push(a);
  }

  // La tabla va dentro de un contenedor con scroll propio: en un teléfono, seis
  // columnas no entran, y sin esto la tabla ensancha la página entera en vez de
  // dejar que se desplace ella sola.
  $('#consents').innerHTML = `<div class="tabla-scroll"><table class="tabla">
    <thead><tr>
      <th>Consentimiento</th><th>Propósito</th><th>Sujeto</th>
      <th>Otorgado</th><th>Vence</th><th>Acciones</th>
    </tr></thead>
    <tbody>${d.consents.map((c) => {
      const acts = accionesPorConsent.get(c.id) || [];
      const acciones = acts.length
        ? acts.map((a) => `<strong style="color:${a.action === 'withdrawn' ? '#c0392b' : '#b5760a'}">${esc(a.action)}</strong> ${esc(a.occurred_at.slice(0, 10))}`).join('<br>')
        : '<span style="color:#9aa5b6">—</span>';
      return `<tr>
        <td><code>${esc(c.id)}</code></td>
        <td>${esc(c.proposito)}</td>
        <td><code>${esc(c.sujeto)}</code></td>
        <td>${esc(c.granted_at.slice(0, 10))}</td>
        <td>${c.expires_at ? esc(c.expires_at.slice(0, 10)) : '<span style="color:#9aa5b6">sin vencimiento</span>'}</td>
        <td>${acciones}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

// ── Contraprueba ────────────────────────────────────────────────────────────
$('#btn-contraprueba').addEventListener('click', async () => {
  const b = $('#btn-contraprueba');
  b.disabled = true;
  const salida = $('#contraprueba');
  salida.innerHTML = '<p class="nota">Correr…</p>';
  try {
    const r = await pedir('/api/rechazar-consentimiento');
    const revocados = r.accionable.filter((a) => a.veredicto === 'revocado').length;
    salida.innerHTML = `
      <div class="aviso ${revocados === 0 ? 'ok' : 'mal'}">
        <strong>${revocados === 0
          ? 'Sin retiradas, no hay revocados. Correcto.'
          : 'Aparecen revocados aunque no haya ninguna retirada. Eso estaría mal.'}</strong>
        Con ninguna retirada de consentimiento, el escenario da
        <b>${r.conteo.revocado} revocado(s)</b> de ${r.conteo.total} envíos.
        ${revocados === 0
          ? 'Es lo que tiene que pasar: el veredicto <code>revocado</code> sale de las acciones registradas, no de algo fijo en el panel.'
          : ''}
      </div>
      <div class="tabla-scroll"><table class="tabla"><thead><tr><th>seq</th><th>Veredicto</th><th>Motivo</th></tr></thead>
      <tbody>${r.accionable.map((a) => `<tr>
        <td>${a.seq}</td><td><span class="etiqueta ${a.veredicto}">${esc(NOMBRES[a.veredicto] || a.veredicto)}</span></td>
        <td>${esc(a.motivo)}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) {
    salida.innerHTML = `<div class="aviso mal"><strong>Falló la contraprueba.</strong>${esc(e.message)}</div>`;
  } finally {
    b.disabled = false;
  }
});

// ── Mesa de evidencia ───────────────────────────────────────────────────────
const FUENTE_NOMBRE = {
  probanza: 'consentimientos',
  conformidad: 'manual de procedimientos',
  seguridad: 'sonda de seguridad',
};

const NIVEL_TXT = {
  5: 'crítica', 4: 'alta', 3: 'media', 2: 'baja', 1: 'informativa',
};

async function cargarMesa() {
  const caja = $('#mesa');
  try {
    const m = await fetch('/api/mesa').then((r) => r.json());

    const c = m.cruce.resumen;
    const f = m.fuentes;
    const cfg = m.config ?? {};

    // Si la sonda es un fixture, su cruce con el manual no es independiente.
    const circular = String(f.seguridad.origen ?? '').includes('fixture');

    // La entidad y de dónde salió cada ruta. Sin esto, un tablero con la cifra
    // de una entidad puede estar mostrando los datos de otra y el que lo mira
    // no tiene cómo enterarse salvo que adivine el archivo.
    const ent = cfg.entidad ?? {};
    const encabezado = `
      <div class="entidad">
        <span class="nombre">${esc(ent.nombre || 'entidad sin configurar')}</span>
        ${ent.dominio ? `<span class="dominio">${esc(ent.dominio)}</span>` : ''}
        ${cfg.archivo ? `<span class="cfg">vía ${esc(cfg.archivo)}</span>`
    : '<span class="cfg">sin archivo de configuración: valores por defecto</span>'}
        ${cfg.strix_objetivo ? `<span class="cfg">objetivo de sonda: ${esc(cfg.strix_objetivo)}</span>` : ''}
        ${cfg.desde ? `<span class="cfg">escenario desde ${esc(cfg.desde)}</span>` : ''}
      </div>`;

    const origen = `
      <div class="origenes">
        ${Object.entries(f).map(([k, v]) =>
      `<span class="etiqueta ${v.origen?.includes('real') ? 'cubierto' : 'sin_cobertura'}"
        title="${esc(v.ruta || v.de || '')}">
        ${esc(FUENTE_NOMBRE[k] || k)}: ${esc(v.origen)}</span>`).join('')}
      </div>
      ${Object.entries(f).filter(([, v]) => v.contradice).map(([k, v]) =>
      `<div class="aviso mal"><strong>${esc(FUENTE_NOMBRE[k] || k)}: la configuración dice una cosa y el archivo dice otra.</strong>
         La configuración lo declara «${esc(v.origen_declarado)}», pero el archivo está dentro del paquete,
         así que se muestra como «${esc(v.origen)}». Manda el archivo, no la etiqueta.</div>`).join('')}`;

    const tarjetas = `
      <div class="tarjetas">
        <div class="tarjeta"><span class="n">${f.conformidad.totales.controles}</span>
          <span class="t">controles revisados</span></div>
        <div class="tarjeta"><span class="n">${c.cobertura_actual_pct}%</span>
          <span class="t">cobertura hoy</span></div>
        <div class="tarjeta"><span class="n">${c.cobertura_con_sondas_pct}%</span>
          <span class="t">si se corre lo escrito</span></div>
        <div class="tarjeta"><span class="n">${c.contradicciones}</span>
          <span class="t">contradicciones</span></div>
        <div class="tarjeta"><span class="n">${f.conformidad.totales.sin_verificar}</span>
          <span class="t">sin verificar</span></div>
        <div class="tarjeta"><span class="n">${m.abierta.length}</span>
          <span class="t">abiertos en total</span></div>
      </div>`;

    const cadenas = Object.entries(m.cadenas.porFuente).map(([k, v]) =>
      `<span class="etiqueta ${v.ok ? 'cubierto' : 'revocado'}">${FUENTE_NOMBRE[k] || k}: ${v.ok ? 'íntegra' : 'ROTA'}</span>`).join(' ');

    const contradicciones = m.cruce.contradicciones.length
      ? `<div class="aviso mal"><strong>Dos fuentes se apuntan al mismo lugar.</strong>
         ${circular
      ? '<b>Pero no son independientes:</b> el reporte de sonda de este panel es un fixture escrito a imitación de los hallazgos del manual, así que es el mismo dato contado dos veces. No cuenta como corroboración hasta que la sonda se corra de verdad.'
      : 'El manual lo declara y la sonda lo confirma; ninguna de las dos alcanza para afirmarlo sola.'}
         <ul>${m.cruce.contradicciones.map((x) => `<li><code>${esc(x.control)}</code> — el manual lo declara ${esc(x.estado_declarado)}${circular ? ' y el reporte de sonda señala el mismo lugar, pero ese reporte está derivado del manual' : ` y una sonda independiente encontró ${esc(String(x.n_hallazgos ?? 1))} problema(s) en la misma área`}</li>`).join('')}</ul></div>`
      : '';

    const oscuras = m.zonas_oscuras.length
      ? `<div class="aviso"><strong>${m.zonas_oscuras.length} control(es) se resolverían corriendo lo que ya está escrito.</strong>
         ${m.zonas_oscuras.slice(0, 12).map((z) => `<code>${esc(z.id)}</code>`).join(' ')}
         ${m.zonas_oscuras.length > 12 ? '…' : ''}</div>`
      : '';

    const filas = m.abierta.map((x) => `
      <div class="fila">
        <div class="fila-cab">
          <span class="etiqueta n${x.nivel}">${esc(NIVEL_TXT[x.nivel] || x.nivel)}</span>
          <code>${esc(x.clave)}</code>
          <span class="categoria">${esc(FUENTE_NOMBRE[x.fuente] || x.fuente)}</span>
          ${x.nuevo ? '<span class="nuevo">nuevo</span>' : ''}
        </div>
        <div class="texto">${esc((x.titulo || '').slice(0, 120))}</div>
        <div class="motivo">${esc((x.motivo || '').slice(0, 150))}</div>
      </div>`).join('');

    caja.innerHTML = `
      ${encabezado}
      ${tarjetas}
      ${origen}
      <div class="cadenas-mesa">${cadenas}</div>
      ${contradicciones}
      ${oscuras}
      <h3>Abierto, por fuente</h3>
      <div class="filas">${filas}</div>`;
    caja.classList.add('mesa');
  } catch (e) {
    caja.innerHTML = `<div class="aviso mal"><strong>No se pudo cargar la mesa.</strong>${esc(e.message)}</div>`;
  }
}

cargar();
cargarMesa();