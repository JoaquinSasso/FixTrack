# FixTrack SaaS 🛠️
### Plataforma de Gestión Técnica con Arquitectura Multi-inquilino

**FixTrack** es una solución profesional diseñada para escalar el flujo de trabajo de servicios técnicos y talleres. No es solo un gestor de órdenes; es un sistema **SaaS completo** que permite a múltiples negocios operar de forma aislada bajo una arquitectura robusta, segura y centrada en el rendimiento.

---

## 🚀 Portafolio: Aspectos Técnicos Destacados

Este proyecto demuestra competencias de nivel avanzado en desarrollo Full-Stack y Arquitectura de Software:

### 1. Seguridad Avanzada y Multi-tenancy (RBAC)
A diferencia de proyectos educativos, FixTrack implementa un aislamiento de datos estricto mediante **Firestore Security Rules** dinámicas.
- **Logro:** El backend valida en cada petición si el usuario pertenece al `businessId` del recurso solicitado y si su rol (`owner`, `admin`, `tecnico`) le permite realizar la acción.
- **Evidencia:** Revisa `firestore.rules` para ver la implementación de funciones como `isActiveStaff()` y `isPlatformAdmin()`.

### 2. Estrategia de Rendimiento: Cache-First UI
Para garantizar una experiencia de usuario fluida, se implementó una lógica de carga híbrida.
- **Logro:** Uso de `getDocsFromCache` en combinación con `onSnapshot` para renderizar datos en menos de 50ms, sincronizando cambios en tiempo real sin bloquear la interfaz.
- **Evidencia:** Implementado en `js/core/ordersRepo.js`.

### 3. Gestión de Sesiones Exclusivas
Se desarrolló un sistema para rastrear dispositivos activos y evitar el uso compartido de cuentas no autorizado.
- **Logro:** El módulo `exclusive-device-session.js` rastrea el `activeDeviceId`, permitiendo un control granular de la actividad por negocio.

### 4. Motor de Mensajería y Plantillas Dinámicas
- **Logro:** Un motor basado en **Regex** que inyecta variables de negocio (`NOMBRE_CLIENTE`, `NUMERO_ORDEN`, `LINK_SEGUIMIENTO`) en plantillas personalizables para WhatsApp.
- **Evidencia:** Lógica centralizada en `js/pages/orderDetails/whatsapp.js`.

---

## 🛠️ Stack Tecnológico

- **Frontend:** HTML5, CSS3, JavaScript Moderno (Módulos ES6).
- **Backend:** Firebase (Firestore, Authentication, Hosting).
- **Arquitectura:** Patrón Repositorio para el desacoplamiento de la lógica de datos y la UI.
- **Herramientas:** Integración con la API de WhatsApp Web.

---

## 📁 Estructura del Proyecto

- `core/`: Repositorios de datos (`ordersRepo.js`, `clientsRepo.js`) y lógica de negocio compartida.
- `pages/`: Controladores específicos para cada vista de la aplicación.
- `userSessions/`: Lógica de integridad de sesión por dispositivo.
- `firestore.rules`: El "firewall" lógico de la aplicación.

---

## 🔧 Instalación

1. Clonar el repositorio.
2. Configurar el objeto `firebaseConfig` en `public/st/js/firebase.js`.
3. Desplegar las reglas de seguridad: `firebase deploy --only firestore:rules`.
4. Iniciar mediante un servidor local o Firebase Hosting.

---

## 🧑‍💻 Autor

**Joaquín Sasso**
*Estudiante de Ciencias de la Computación (UNSJ) & Desarrollador Android/Full-Stack*

- **LinkedIn:** [linkedin.com/in/joasasso](https://www.linkedin.com/in/joasasso/)
- **GitHub:** [@JoaquinSasso](https://github.com/JoaquinSasso)
- **Mi App en Play Store:** [MiniToolbox](https://play.google.com/store/apps/details?id=com.joasasso.minitoolbox)

---
*"Software de calidad: donde la arquitectura y el rendimiento se encuentran."*
