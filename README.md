# payments-tug — Servicio de Pagos con Stripe

Microservicio en Node.js + TypeScript que actúa como backend seguro para procesar pagos con Stripe. Diseñado para ser consumido por aplicaciones móviles (Flutter) o cualquier cliente que pueda hacer peticiones HTTP.

---

## Tabla de contenidos

1. [¿Por qué existe este servicio?](#1-por-qué-existe-este-servicio)
2. [Arquitectura general](#2-arquitectura-general)
3. [El flujo completo de un pago](#3-el-flujo-completo-de-un-pago)
4. [Autenticación con JWT](#4-autenticación-con-jwt)
5. [Cómo funciona Stripe en este servicio](#5-cómo-funciona-stripe-en-este-servicio)
6. [Los archivos del proyecto explicados](#6-los-archivos-del-proyecto-explicados)
7. [Endpoints de la API](#7-endpoints-de-la-api)
8. [Variables de entorno](#8-variables-de-entorno)
9. [Cómo correr el servicio](#9-cómo-correr-el-servicio)
10. [Cómo probarlo](#10-cómo-probarlo)
11. [Glosario de conceptos clave](#11-glosario-de-conceptos-clave)

---

## 1. ¿Por qué existe este servicio?

Cuando una app quiere cobrar dinero usando Stripe, **nunca debe hablar directamente con Stripe desde el cliente** (móvil o web). La razón es simple: para crear pagos necesitas tu `STRIPE_SECRET_KEY`, y si esa clave estuviera en la app móvil, cualquier persona podría extraerla y cobrar en tu nombre o hacer cargos fraudulentos.

La solución es tener un servidor intermedio que:
1. Guarda la `STRIPE_SECRET_KEY` de forma segura
2. Recibe peticiones del cliente
3. Habla con Stripe usando esa clave
4. Devuelve al cliente solo la información mínima necesaria

Este servicio es ese servidor intermedio.

```
Flutter App  ──────────►  payments-tug  ──────────►  Stripe API
   (cliente)               (este servidor)            (procesador de pagos)
```

---

## 2. Arquitectura general

```
payments-tug/
├── server.ts                        # Entry point — arranca el servidor HTTP
├── src/
│   ├── types/index.ts               # Interfaces TypeScript (contratos de datos)
│   ├── middleware/
│   │   └── auth.ts                  # Guardia de seguridad — verifica JWT en cada request
│   ├── controllers/
│   │   └── paymentControllers.ts    # Lógica de negocio — crea y consulta pagos
│   └── routes/
│       └── payments.ts              # Mapa de rutas — conecta URLs con controladores
├── .env                             # Variables de entorno secretas (nunca en git)
├── package.json                     # Dependencias y scripts
└── tsconfig.json                    # Configuración del compilador TypeScript
```

### El recorrido de un request

Cuando llega una petición `POST /payments`, recorre este camino:

```
Request HTTP
     │
     ▼
server.ts (recibe la petición)
     │
     ▼
express.json() (parsea el body JSON)
     │
     ▼
src/routes/payments.ts (¿a qué controller va?)
     │
     ▼
src/middleware/auth.ts (¿tiene JWT válido?)
     │  No → responde 401
     │  Sí ↓
     ▼
src/controllers/paymentControllers.ts (lógica del pago)
     │
     ▼
Stripe API (crea el PaymentIntent)
     │
     ▼
Respuesta JSON al cliente
```

---

## 3. El flujo completo de un pago

Este es el flujo real de extremo a extremo cuando un usuario paga en tu app Flutter:

### Paso 1 — Flutter inicia el pago

El usuario toca "Pagar $109.99". Flutter llama a este servicio:

```
POST /payments
Authorization: Bearer <jwt_del_usuario>
Content-Type: application/json

{
  "amount": 10999,
  "currency": "mxn",
  "metadata": { "userId": "abc123", "serviceType": "ride" }
}
```

**Nota sobre el amount:** Stripe trabaja en la unidad mínima de la moneda. Para MXN (pesos mexicanos), la unidad mínima es el centavo. Por eso $109.99 se representa como `10999` (centavos). Nunca se mandan decimales.

### Paso 2 — El middleware verifica identidad

Antes de llegar a la lógica del pago, el middleware `auth.ts` intercepta la petición y verifica que el JWT en el header `Authorization` sea válido y esté firmado con tu `JWT_SECRET_KEY`. Si no lo es, responde inmediatamente con `401 Unauthorized` y el request nunca llega al controller.

### Paso 3 — El controller crea un PaymentIntent en Stripe

El controller llama a la API de Stripe:

```
stripe.paymentIntents.create({
  amount: 10999,
  currency: "mxn",
  metadata: { userId: "abc123", serviceType: "ride" },
  automatic_payment_methods: { enabled: true }
})
```

Stripe registra la intención de cobro y devuelve un objeto `PaymentIntent` con dos datos clave:
- `id`: identificador único del pago (ej: `pi_3TWMajK522dd1AQX0k9faOrD`)
- `client_secret`: una clave temporal que solo sirve para completar este pago específico

### Paso 4 — El servidor responde a Flutter

```json
{
  "clientSecret": "pi_3TWMajK522dd1AQX0k9faOrD_secret_5KL0MNnd3...",
  "paymentIntentId": "pi_3TWMajK522dd1AQX0k9faOrD"
}
```

### Paso 5 — Flutter completa el pago directamente con Stripe

Con el `clientSecret`, Flutter usa el SDK de Stripe para mostrar la pantalla de pago (captura de tarjeta). El usuario ingresa sus datos. **Esta parte ocurre directamente entre Flutter y Stripe** — los datos de la tarjeta nunca pasan por tu servidor.

### Paso 6 — Verificar el estado del pago

Después de que el usuario completa el pago, tu app puede verificar el resultado:

```
GET /payments/pi_3TWMajK522dd1AQX0k9faOrD
Authorization: Bearer <jwt_del_usuario>
```

Respuesta:
```json
{
  "id": "pi_3TWMajK522dd1AQX0k9faOrD",
  "status": "succeeded",
  "amount": 10999,
  "currency": "mxn"
}
```

### ¿Por qué este flujo de dos pasos?

La razón de separar "crear el PaymentIntent" y "completar el pago" es seguridad. El `client_secret` es una clave de un solo uso que:
- Solo sirve para completar ese PaymentIntent específico
- Expira si no se usa
- No permite crear nuevos cobros

Así, incluso si alguien interceptara el `client_secret`, lo peor que podría hacer es completar ese pago específico — no puede crear cargos adicionales.

---

## 4. Autenticación con JWT

### ¿Qué es un JWT?

JWT (JSON Web Token) es un estándar para transmitir información de forma segura entre dos partes. Un JWT se ve así:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiaWF0IjoxNzc4NjE2MjkxfQ.Sj5iRa2pVoDZe8LQ...
```

Son tres partes separadas por puntos:
1. **Header** (base64) — algoritmo usado (`HS256`)
2. **Payload** (base64) — datos del usuario (`{ sub: "user123", iat: 1778616291 }`)
3. **Signature** — firma criptográfica que garantiza que nadie modificó el token

### ¿Por qué se usa aquí?

Este servicio no sabe nada de usuarios — no tiene base de datos propia. Delega la autenticación a quien ya la maneja (Supabase en el caso de SPOT). Supabase genera JWTs firmados con un secreto cuando el usuario hace login. Este servicio simplemente verifica que ese JWT sea válido.

### El flujo de autenticación

```
Usuario hace login en Flutter (Supabase)
          │
          ▼
Supabase devuelve un JWT firmado con JWT_SECRET_KEY
          │
          ▼
Flutter guarda el JWT y lo manda en cada request a este servicio
          │
          ▼
auth.ts verifica la firma del JWT con el mismo JWT_SECRET_KEY
          │
    válido ↓          inválido →  401 Unauthorized
          ▼
  Request continúa
```

### Lo que hace auth.ts paso a paso

```typescript
// 1. Lee el header Authorization
const authHeader = req.headers['authorization'];
// Ejemplo: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

// 2. Si no existe, rechaza
if (!authHeader) → 401

// 3. Extrae el token (quita "Bearer ")
const token = authHeader.split(' ')[1];
// split(' ') → ["Bearer", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."]
// [1] → "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

// 4. Verifica la firma criptográfica
jwt.verify(token, secret);
// Si el token fue modificado, expiró, o fue firmado con otro secreto → lanza excepción

// 5. Si todo está bien, deja pasar
next();
```

`jwt.verify()` hace tres verificaciones automáticamente:
- La firma es válida (el token no fue alterado)
- El token no ha expirado (si tiene campo `exp`)
- Fue firmado con el secreto correcto

---

## 5. Cómo funciona Stripe en este servicio

### El objeto PaymentIntent

Un `PaymentIntent` es el objeto central de Stripe para pagos. Representa una intención de cobrar dinero y tiene un ciclo de vida:

```
requires_payment_method  →  (usuario ingresa tarjeta)
         │
         ▼
requires_confirmation    →  (Stripe confirma)
         │
         ▼
processing               →  (procesando)
         │
         ▼
succeeded                →  (pago exitoso ✓)

O en cualquier punto:
canceled                 →  (cancelado)
requires_payment_method  →  (falló, se puede reintentar)
```

### automatic_payment_methods: { enabled: true }

Esta opción le dice a Stripe que muestre automáticamente los métodos de pago disponibles para la región del usuario (tarjetas, OXXO, transferencias bancarias, etc.). Sin esta opción, tendrías que especificar manualmente `payment_method_types: ['card']`.

### El client_secret

Es el identificador privado del PaymentIntent del lado del cliente. Su formato es:

```
pi_3TWMajK522dd1AQX0k9faOrD_secret_5KL0MNnd3tGmRwdJApiyKABCA
│                           │
└─── paymentIntentId ───────┘└──── parte secreta ────────────┘
```

El SDK de Stripe en Flutter lo usa para asociar la pantalla de pago con el PaymentIntent correcto.

### El metadata

El campo `metadata` en Stripe es un objeto de pares clave-valor que Stripe guarda junto al pago. No afecta el procesamiento — es solo para tu referencia. Útil para:
- Saber qué usuario hizo el pago: `{ userId: "abc123" }`
- Saber qué servicio fue: `{ serviceType: "ride", rideId: "xyz" }`
- Hacer conciliación contable

Puedes ver estos datos en el dashboard de Stripe junto a cada pago.

### Modo test vs producción

La `STRIPE_SECRET_KEY` determina el entorno:
- `sk_test_...` → modo prueba, los pagos son simulados, no se cobra dinero real
- `sk_live_...` → modo producción, cobra dinero real

En modo test, puedes usar la tarjeta `4242 4242 4242 4242` con cualquier fecha futura y cualquier CVC para simular un pago exitoso.

---

## 6. Los archivos del proyecto explicados

### server.ts

El punto de entrada de la aplicación. Hace tres cosas:
1. `dotenv.config()` — carga las variables del archivo `.env` en `process.env` antes de que cualquier otro módulo las necesite
2. Configura Express con `express.json()` para poder leer el body de los requests
3. Monta el router de pagos en la ruta `/payments`

```typescript
app.use('/payments', paymentsRouter);
```

Esto significa que todas las rutas definidas en `paymentsRouter` tendrán el prefijo `/payments`. Por eso en el router defines `'/'` y `'/:id'` en lugar de `'/payments'` y `'/payments/:id'`.

### src/types/index.ts

Define los contratos de datos usando interfaces de TypeScript. Una interfaz describe la "forma" que debe tener un objeto — qué campos tiene y de qué tipo son. TypeScript usa estas interfaces para detectar errores en tiempo de compilación, no en ejecución.

- `PaymentRequest` — lo que debe mandar el cliente en el body del POST
- `PaymentResponse` — lo que devuelve el POST
- `PaymentStatusResponse` — lo que devuelve el GET

El `status` usa un **union type** (`"succeeded" | "processing" | ...`) en lugar de `string`. Esto significa que TypeScript te avisará si intentas asignar un valor que Stripe nunca devolvería.

### src/middleware/auth.ts

Un middleware en Express es una función que se ejecuta entre que llega el request y que llega al controller. Tiene acceso a `req`, `res`, y `next`. Si llama `next()`, el request continúa. Si responde con `res.json()`, el request termina ahí.

La firma `(req, res, next): void` es importante — devuelve `void` (nada) porque Express maneja el ciclo de vida del request, no la función.

### src/controllers/paymentControllers.ts

Contiene la lógica de negocio real. Dos funciones `async` porque las llamadas a Stripe son asíncronas (van por internet y tardan).

**Inicialización lazy de Stripe:**
```typescript
const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY as string);
```

Stripe se inicializa dentro de una función en lugar de al cargar el módulo. Esto es necesario porque los `import` de TypeScript se ejecutan antes que `dotenv.config()` en server.ts — si Stripe se inicializara al cargar el módulo, `process.env.STRIPE_SECRET_KEY` aún sería `undefined`.

**El `as string`:** TypeScript sabe que las variables de entorno pueden ser `undefined` (si no están en el `.env`). Con `as string` le decimos "confía en mí, esto va a tener valor". Si en producción faltara la variable, el error aparecería en runtime, no en compilación.

### src/routes/payments.ts

El router conecta URLs con funciones. En Express, cuando se registra:
```typescript
router.post('/', authMiddleware, createPayment);
```

Express ejecuta los argumentos en orden:
1. `authMiddleware` — si llama `next()`, continúa
2. `createPayment` — maneja el request

Puedes encadenar tantos middlewares como quieras antes del controller final.

---

## 7. Endpoints de la API

### POST /payments

Crea un nuevo PaymentIntent en Stripe.

**Headers requeridos:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "amount": 10999,
  "currency": "mxn",
  "metadata": {
    "userId": "abc123",
    "serviceType": "ride"
  }
}
```

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| amount | number | Sí | Monto en centavos (10999 = $109.99) |
| currency | string | Sí | Código ISO de moneda en minúsculas ("mxn", "usd") |
| metadata | object | No | Pares clave-valor para tu referencia |

**Respuesta exitosa (200):**
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_3TWMajK522dd1AQX0k9faOrD"
}
```

**Errores posibles:**
| Código | Causa |
|--------|-------|
| 400 | amount o currency faltante, o amount <= 0 |
| 401 | JWT inválido, expirado, o ausente |
| 500 | Error al comunicarse con Stripe |

---

### GET /payments/:id

Consulta el estado actual de un PaymentIntent.

**Headers requeridos:**
```
Authorization: Bearer <jwt_token>
```

**Parámetro de URL:**
- `:id` — el `paymentIntentId` devuelto por el POST (formato: `pi_...`)

**Respuesta exitosa (200):**
```json
{
  "id": "pi_3TWMajK522dd1AQX0k9faOrD",
  "status": "succeeded",
  "amount": 10999,
  "currency": "mxn"
}
```

**Valores posibles de status:**
| Status | Significado |
|--------|-------------|
| requires_payment_method | Esperando que el usuario ingrese método de pago |
| requires_confirmation | Listo para confirmar |
| processing | Stripe está procesando el pago |
| succeeded | Pago exitoso |
| canceled | Cancelado |

**Errores posibles:**
| Código | Causa |
|--------|-------|
| 401 | JWT inválido, expirado, o ausente |
| 500 | ID inválido o error de Stripe |

---

## 8. Variables de entorno

El archivo `.env` debe existir en la raíz del proyecto y **nunca debe subirse a git** (está en `.gitignore`).

```env
PORT=3000
JWT_SECRET_KEY=tu_secreto_largo_y_aleatorio
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

| Variable | Descripción | Dónde obtenerla |
|----------|-------------|-----------------|
| PORT | Puerto en que escucha el servidor | Cualquier número, 3000 por default |
| JWT_SECRET_KEY | Secreto para firmar y verificar JWTs | Lo defines tú — debe ser el mismo que usa Supabase |
| STRIPE_SECRET_KEY | Clave privada de Stripe | dashboard.stripe.com → Developers → API keys |
| STRIPE_PUBLISHABLE_KEY | Clave pública de Stripe | Mismo lugar — la usa Flutter directamente |

**Importante sobre JWT_SECRET_KEY y Supabase:**
Supabase firma sus JWTs con el `JWT Secret` que puedes ver en tu proyecto de Supabase (Settings → API → JWT Secret). Para que este servicio valide los tokens de Supabase, el valor de `JWT_SECRET_KEY` en tu `.env` debe ser exactamente ese mismo string.

---

## 9. Cómo correr el servicio

### Requisitos
- Node.js 18+
- Una cuenta de Stripe (gratuita)
- El archivo `.env` configurado

### Instalación
```bash
npm install
```

### Desarrollo (con recarga automática)
```bash
npm run dev
```
Usa `ts-node` para ejecutar TypeScript directamente sin compilar.

### Producción
```bash
npm run build   # Compila TypeScript → JavaScript en /dist
npm start       # Ejecuta el JavaScript compilado
```

---

## 10. Cómo probarlo

### Generar un JWT de prueba
```bash
# Desde la raíz del proyecto
node -e "const jwt = require('jsonwebtoken'); console.log(jwt.sign({ sub: 'test' }, 'TU_JWT_SECRET_KEY'))"
```

### Crear un pago (PowerShell)
```powershell
$token = "el_jwt_generado_arriba"
Invoke-RestMethod -Uri "http://localhost:3000/payments" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } `
  -Body '{"amount": 1099, "currency": "mxn"}'
```

### Consultar estado de un pago (PowerShell)
```powershell
$token = "el_jwt_generado_arriba"
Invoke-RestMethod -Uri "http://localhost:3000/payments/pi_XXXXX" `
  -Headers @{ "Authorization" = "Bearer $token" }
```

### Tarjetas de prueba de Stripe
| Número | Resultado |
|--------|-----------|
| 4242 4242 4242 4242 | Pago exitoso |
| 4000 0000 0000 0002 | Tarjeta declinada |
| 4000 0025 0000 3155 | Requiere autenticación 3D Secure |

Fecha: cualquier fecha futura. CVC: cualquier 3 dígitos.

---

## 11. Glosario de conceptos clave

**PaymentIntent** — Objeto de Stripe que representa una intención de cobro. Tiene un ciclo de vida que va desde `requires_payment_method` hasta `succeeded` o `canceled`.

**client_secret** — Token de un solo uso que Stripe genera para cada PaymentIntent. Lo usa el SDK de Stripe en el cliente (Flutter) para completar el pago. No sirve para crear nuevos cobros.

**JWT (JSON Web Token)** — Token firmado criptográficamente que prueba la identidad de quien hace el request. Tiene tres partes: header, payload, y firma. La firma garantiza que nadie lo modificó.

**Middleware** — Función en Express que intercepta requests antes de que lleguen al controller. Puede rechazar el request (ej: auth fallida) o dejarlo pasar llamando `next()`.

**Router** — Objeto de Express que agrupa rutas relacionadas. Permite definir `POST /` en lugar de `POST /payments`, porque el prefijo `/payments` se agrega al montarlo en `server.ts`.

**dotenv** — Librería que lee el archivo `.env` y carga sus variables en `process.env`. Se llama al inicio de la app para que todas las variables estén disponibles antes de que cualquier módulo las necesite.

**TypeScript `as string`** — Aserción de tipo. Le dice al compilador "trata esto como string aunque su tipo sea `string | undefined`". Útil para variables de entorno que sabes que van a estar definidas en runtime.

**Inicialización lazy** — Patrón donde un recurso se crea solo cuando se necesita por primera vez, no al cargar el módulo. Se usa para Stripe en este proyecto para garantizar que `dotenv.config()` ya se haya ejecutado.

**Centavos en Stripe** — Stripe siempre trabaja con enteros en la unidad mínima de la moneda. Para MXN: $109.99 = `10999`. Para USD: $10.99 = `1099`. Esto evita errores de punto flotante en cálculos de dinero.

**metadata en Stripe** — Campo de texto libre (máx 50 claves, 500 caracteres por valor) que Stripe guarda junto al PaymentIntent. No afecta el procesamiento del pago — es solo para tu referencia y aparece en el dashboard de Stripe.
