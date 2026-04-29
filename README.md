# FixTrack 🛠️
### Sistema de Gestión Técnica SaaS Multi-tenant

**FixTrack** es un sistema de gestión para talleres y servicios técnicos construido como SaaS multi-tenant. Opera en producción desde noviembre 2024, gestionando el flujo completo de un taller de servicios técnicos en San Juan, Argentina.

El sistema reemplazó un software legacy de 15 años tras dos meses de levantamiento de requerimientos con los técnicos del taller e iteración continua con feedback de usuarios finales.

**Nota sobre este repositorio:** Este repo público es un mirror del repositorio privado principal (100+ commits) creado tras limpiar credenciales sensibles y configuración específica del cliente. Muestra la arquitectura y decisiones técnicas sin exponer datos operacionales.

---

## 🚀 Aspectos Técnicos Principales

### 1. Arquitectura Multi-tenant con RBAC

El sistema implementa aislamiento estricto de datos por negocio mediante **Firestore Security Rules dinámicas**.

- El backend valida en cada petición que el usuario pertenece al `businessId` del recurso y que su rol (`owner`, `admin`, `technician`) le permite realizar la operación.
- La lógica de permisos está centralizada en funciones como `isActiveStaff()` y `isPlatformAdmin()` (ver `firestore.rules`).

### 2. Optimización de Renderizado: Cache-First

Implementé una estrategia de carga híbrida para garantizar tiempos de respuesta inferiores a 50ms en listas de órdenes.

- Combinación de `getDocsFromCache()` + `onSnapshot()` de Firestore: los datos se muestran inmediatamente desde cache local mientras se sincronizan cambios en tiempo real en segundo plano.
- Implementado en `js/core/ordersRepo.js`.

### 3. Motor de Plantillas para WhatsApp API

Desarrollé un sistema de notificaciones automatizadas que reemplazó un cuello de botella operativo: antes los técnicos debían copiar manualmente el número del cliente en un teléfono compartido para notificar vía WhatsApp.

- El motor inyecta variables dinámicas (`NOMBRE_CLIENTE`, `NUMERO_ORDEN`, `LINK_SEGUIMIENTO`) en plantillas personalizables.
- Implementado con Regex en `js/pages/orderDetails/whatsapp.js`.

### 4. Gestión de Sesiones por Dispositivo

Sistema de tracking de dispositivos activos para evitar uso compartido de cuentas no autorizado.

- El módulo `exclusive-device-session.js` rastrea el `activeDeviceId` por negocio, permitiendo control granular de acceso.

---

## 🛠️ Stack Tecnológico

- **Frontend:** JavaScript ES6 Modules, HTML5, CSS3
- **Backend:** Firebase (Firestore, Authentication, Functions, Hosting)
- **Arquitectura:** Patrón Repositorio para desacoplar lógica de datos de UI

---

## 📁 Estructura del Proyecto

```
public/
├── st/js/
│   ├── core/              # Repositorios (ordersRepo, clientsRepo)
│   ├── pages/             # Controladores por vista
│   ├── userSessions/      # Lógica de sesiones por dispositivo
│   └── firebase.js        # Configuración Firebase
├── firestore.rules        # Security Rules (RBAC)
```

---

## 🔧 Instalación

1. Clonar el repositorio
2. Configurar `firebaseConfig` en `public/st/js/firebase.js`
3. Desplegar reglas de seguridad: `firebase deploy --only firestore:rules`
4. Iniciar con servidor local o Firebase Hosting

---

## 📊 Métricas Operacionales

- En producción desde noviembre 2024
- +1.300 órdenes procesadas
- Uso diario en operación real

---

## 🧑‍💻 Autor

**Joaquín Sasso**  
Estudiante de Ciencias de la Computación (UNSJ) | Desarrollador Android & Web

- **LinkedIn:** [linkedin.com/in/joaquinsasso](https://www.linkedin.com/in/joasasso/)
- **GitHub:** [@JoaquinSasso](https://github.com/JoaquinSasso)
- **MiniToolbox en Play Store:** [5,0/5 con 23 reseñas](https://play.google.com/store/apps/details?id=com.joasasso.minitoolbox)
