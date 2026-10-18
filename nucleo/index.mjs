// Superficie pública del eje de evidencia.
//
// Un solo archivo por el que entrar. La razón es práctica: quien integra esto
// en ARCOP o en el anonimizador debería poder importar lo que necesita sin
// conocer la forma de las carpetas, y sin terminar acoplándose a un módulo
// interno por accidente.

export {
  canonico, sha256, hashEvento, validarEvento, VERSION_EVENTO,
} from './canonica.mjs';

export {Cadena} from './cadena.mjs';

export {
  emitirRecibo, firmarRecibo, verificarRecibo,
  generarParDeLLAves, registrarLlave, olvidarLlave, llavesRegistradas,
  VERSION_RECIBO, ALGORITMO,
} from './recibo.mjs';

export {
  estadoDe, verificarCobertura, verificarTodo, Veredicto, VERSION_POLITICA,
} from './verificador.mjs';

export {anclar, comprobarAnclaje, publicadorDePrueba} from './ancla.mjs';

export {
  SalidaAuditada, ProveedorAuditado, referenciaDeSujeto,
} from './salida-auditada.mjs';