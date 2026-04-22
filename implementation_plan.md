# Arquitectura de Renderizado Local 100% Web (Versión 2.0)

Este documento detalla el plan para migrar el motor de renderizado de FFmpeg (servidor backend) a una arquitectura totalmente local, ejecutada dentro del navegador del usuario aprovechando la aceleración de su propia tarjeta gráfica.

## ⚠️ User Review Required

> [!WARNING]
> La terminal falló al intentar crear la rama de git automáticamente (`powershell no encontrado`). Por favor, **crea tú la rama manualmente** en tu terminal ejecutando:
> `git checkout -b local-render-webcodecs`
> antes de aprobar este plan.

## 💡 Estrategia de Ingeniería: "El Híbrido Perfecto"

Codificar video en el navegador es fácil con `WebCodecs`, pero extraer y manipular el audio de un MP4 en Javascript puro es una pesadilla de decodificación. Para resolver esto usando tu excelente idea de "solo pegar el audio", usaremos una arquitectura en **dos fases**:

1. **Fase Visual (WebCodecs GPU Encoder):** 
   Crearemos un motor que avance los dos videos fotograma a fotograma de forma invisible, dibuje la composición (hstack + textos) en un elemento `<canvas>`, y se lo envíe a `WebCodecs VideoEncoder`. Usaremos la librería ligera `mp4-muxer` para empaquetar esto en un archivo `silent_render.mp4` a la máxima velocidad que permita la GPU local.
   
2. **Fase de Audio (Paso Directo con FFmpeg.wasm):**
   Una vez que tengamos el video mudo ultrarrápido, cargaremos una versión super ligera de `ffmpeg.wasm` en la memoria del navegador. Le enviaremos el `silent_render.mp4` y tu Video Original 1. Ejecutaremos el comando `-c copy` (copia directa, sin renderizar) para que le engrape la pista de audio original al archivo final en cuestión de 1 o 2 segundos. Cero pérdida de calidad de audio.

## 📦 Proposed Changes

### Dependencias [NPM]

Se instalarán dos dependencias clave en tu proyecto local:
- `mp4-muxer`: Para empaquetar los fotogramas de WebCodecs en un archivo `.mp4` válido.
- `@ffmpeg/ffmpeg` y `@ffmpeg/util`: Para la Fase 2 (Muxing de audio ultrarrápido).

---

### [NEW] `src/localRenderer.js` (Motor de Renderizado Frontend)
Creación de un nuevo módulo Javascript que contendrá:
- La lógica de extracción de frames por Canvas.
- El ciclo `VideoEncoder` de WebCodecs.
- La integración de `mp4-muxer`.
- La orquestación de la Fase 1 y Fase 2.

### [MODIFY] `main.js`
- Se actualizará el botón de "Render" para que ya no envíe un `fetch` a `/api/render` del servidor.
- En su lugar, invocará la función de `localRenderer.js`.
- Actualización de la barra de progreso para mostrar el avance del render local (Fase 1: Video, Fase 2: Muxing Audio).

### [MODIFY] `server.js` (Opcional por ahora)
- Por ahora dejaremos intacto el código del servidor backend como "plan B", pero dejaremos de llamarlo desde el frontend.

## 🧪 Verification Plan

1. Iniciar el servidor de desarrollo (`npm run dev`).
2. Cargar dos videos cortos en la interfaz web.
3. Presionar "Render" y observar el Monitor de Recursos del sistema (Task Manager): El uso de la GPU (Codificador de Video) debería subir, probando que es un render local por hardware.
4. Descargar el archivo resultante y comprobar que tiene imagen fluida (60 FPS) y audio perfectamente sincronizado.
