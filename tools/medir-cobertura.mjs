// Medición puntual: ¿el porcentaje de cobertura coincide con los datos?
//
// Se ejecuta desde la raíz del paquete:  node tools/medir-cobertura.mjs
//
// `cruzar` recibe un objeto con tres listas. Pasarle el resultado entero de
// `desdeConformidad` no es lo mismo: `sinVerificar` se pickea por nombre y el
// resto queda en [], y el total que sale no tiene nada que ver.
import {desdeConformidad, desdeSeguridad} from '../mesa/fuentes.mjs';
import {cruzar} from '../mesa/cruce.mjs';

// Los imports se resuelven contra este archivo (`../`). Las rutas de archivo
// que se leen se resuelven contra el directorio de trabajo, que es la raíz del
// paquete, y por eso van sin `../`.
const rutas = {
  colegio: './mesa/fixtures/spaudit-informe-real.json',
  maquina: './mesa/fixtures/spaudit-con-evidencia.json',
};
const seg = desdeSeguridad('./puerta/fixtures/vulnerabilidades-strix.json');

console.log('');
console.log('  informe     total  sin_verif  cerrados    real  declarado');
console.log('  ' + '-'.repeat(68));
for (const [nombre, ruta] of Object.entries(rutas)) {
  const conf = desdeConformidad(ruta);
  const R = cruzar({
    conformidad: conf.items,
    seguridad: seg.items,
    sinVerificar: conf.sinVerificar,
    cumplidos: conf.cumplidos,
  }).resumen;
  const cerrados = R.controles - R.sin_verificar;
  const real = ((cerrados / R.controles) * 100).toFixed(2);
  const coincide = R.controles === conf.totales.controles;
  const ok = Math.round(Number(real)) === R.cobertura_actual_pct ? '' : '   <-- % NO CUADRA';
  const okTotal = coincide ? '' : `   <-- TOTAL: el informe dice ${conf.totales.controles}`;
  console.log(
    `  ${nombre.padEnd(10)} ${String(R.controles).padStart(5)} ${String(R.sin_verificar).padStart(10)} ${String(cerrados).padStart(9)} ${(real + '%').padStart(8)} ${(R.cobertura_actual_pct + '%').padStart(8)}${ok}${okTotal}`
  );
}
console.log('');