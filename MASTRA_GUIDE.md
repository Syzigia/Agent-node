# Guía de Mastra AI: Agentes, Tools, Workflows y HITL

Guía práctica basada en la implementación real del proyecto workflowtest.

---

## Estructura del Proyecto

```
src/mastra/
├── agents/              # Definición de agentes
│   ├── content/         # Agente especializado en contenido
│   │   ├── index.ts     # Configuración del agente
│   │   └── tools/       # Tools específicas del agente
│   └── coordinator/     # Agente coordinador
├── workflows/           # Workflows multi-step
├── workspace/           # Configuración de workspace
├── memory.ts           # Configuración de memoria
└── index.ts            # Punto de entrada y registro
```

---

## 1. Agente (Agent)

### Concepto
Un agente es una entidad autónoma que puede:
- Tomar decisiones basadas en instrucciones
- Usar tools para realizar acciones
- Mantener memoria de conversaciones
- Ejecutar workflows

### Configuración Básica

```typescript
import { Agent } from "@mastra/core/agent";

export const contentAgent = new Agent({
  id: "content-agent",                    // Identificador único
  name: "Content Agent",                  // Nombre descriptivo
  instructions: `Eres un especialista...`, // Prompt del sistema (comportamiento)
  model: "openai/gpt-4o-mini",           // Modelo LLM (formato: provider/model)
  workspace,                              // Workspace para acceso a archivos
  tools: { startTool, resumeTool },       // Tools disponibles
  memory,                                 // Memoria para contexto
});
```

### Instrucciones Efectivas

Las instrucciones deben ser:
- **Claras**: Definir comportamiento esperado
- **Estructuradas**: Usar secciones numeradas
- **Ejemplos concretos**: Mostrar formatos de entrada/salida
- **Restricciones explícitas**: "NUNCA...", "SIEMPRE..."

```typescript
instructions: `## Flujo OBLIGATORIO para cortar silencios

### PASO 1 — Inicia con start-silence-cutter
Llama la tool con el archivo.

### PASO 2 — Presenta resultados
Muestra el campo "summary" exactamente así:
"Encontré los siguientes silencios...
[summary]
¿Apruebas?"

### PASO 3 — Espera respuesta
- Usuario dice "sí" → approved: true
- Usuario dice "no" → approved: false`,
```

---

## 2. Tools

### Concepto
Las tools extienden las capacidades de un agente, permitiéndole:
- Ejecutar código
- Acceder a sistemas externos
- Manipular archivos
- Orquestar workflows

### Tipos de Tools

#### Tool Simple
```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const myTool = createTool({
  id: "my-tool",                          // ID único
  description: "Hace X cuando Y",         // Descripción para el LLM
  inputSchema: z.object({                // Schema de entrada (Zod)
    param: z.string().describe("..."),
  }),
  outputSchema: z.object({               // Schema de salida (opcional pero recomendado)
    result: z.string(),
  }),
  execute: async (inputData, context) => { // Función de ejecución
    const { param } = inputData;
    const { mastra, workspace } = context;
    
    // Lógica aquí
    return { result: "ok" };
  },
});
```

#### Tool con Acceso a Workflow
```typescript
export const startWorkflowTool = createTool({
  id: "start-workflow",
  description: "Inicia un workflow...",
  inputSchema: z.object({
    file: z.string(),
  }),
  outputSchema: z.object({
    status: z.string(),
    data: z.any(),
  }),
  execute: async (inputData, context) => {
    const { mastra } = context;
    
    if (!mastra) {
      throw new Error("Mastra no disponible");
    }
    
    // Obtener workflow registrado
    const workflow = mastra.getWorkflow("silenceCutterWorkflow");
    const run = await workflow.createRun();
    
    const result = await run.start({
      inputData: { file: inputData.file },
    });
    
    return {
      status: result.status,
      data: result,
    };
  },
});
```

### Contexto de Ejecución

```typescript
execute: async (inputData, context) => {
  const { mastra, workspace, agent, workflow } = context;
  
  // mastra: Instancia principal, acceso a workflows registrados
  // workspace: Acceso al filesystem configurado
  // agent: Contexto del agente ejecutor
  // workflow: Contexto si se ejecuta dentro de un workflow
}
```

---

## 3. Workflows

### Concepto
Los workflows definen secuencias estructuradas de pasos (steps) que:
- Procesan datos de forma predecible
- Soportan pausas para aprobación humana (HITL)
- Mantienen estado entre ejecuciones
- Pueden ser reanudados

### Estructura Básica

```typescript
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

// Step 1: Procesamiento inicial
const processStep = createStep({
  id: "process",
  description: "Procesa los datos iniciales",
  inputSchema: z.object({
    data: z.string(),
  }),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Lógica de procesamiento
    return { result: `Procesado: ${inputData.data}` };
  },
});

// Step 2: Aprobación humana (HITL)
const approvalStep = createStep({
  id: "approval",
  description: "Pausa para aprobación",
  inputSchema: z.object({
    result: z.string(),
  }),
  // Schema de datos mostrados al usuario durante la pausa
  suspendSchema: z.object({
    message: z.string(),
    data: z.any(),
  }),
  // Schema de datos esperados al reanudar
  resumeSchema: z.object({
    approved: z.boolean(),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    data: z.any(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    // Si no hay datos de reanudación → pausar
    if (!resumeData) {
      await suspend({
        message: "Revisa y aprueba:",
        data: inputData.result,
      });
      // Código después de suspend() nunca se ejecuta
      return { approved: false, data: null };
    }
    
    // Reanudado con datos del usuario
    return {
      approved: resumeData.approved,
      data: inputData.result,
    };
  },
});

// Crear workflow
export const myWorkflow = createWorkflow({
  id: "my-workflow",
  description: "Workflow con HITL",
  inputSchema: z.object({
    data: z.string(),
  }),
  outputSchema: z.object({
    finalResult: z.string(),
  }),
})
  .then(processStep)    // Encadenar steps
  .then(approvalStep)
  .commit();            // ¡IMPORTANTE! Commit al final
```

### Human-in-the-Loop (HITL)

#### Patrón Suspend/Resume

1. **Suspend**: Pausa el workflow y espera input humano
```typescript
if (!resumeData) {
  await suspend({
    message: "Mensaje para el usuario",
    data: datosAMostrar,
  });
}
```

2. **Resume**: Reanuda con datos del usuario
```typescript
const result = await run.resume({
  step: "approval",              // ID del step que suspendió
  resumeData: {
    approved: true,              // Datos según resumeSchema
  },
});
```

#### Flujo Completo con Tools

```typescript
// Tool 1: Inicia el workflow
export const startTool = createTool({
  execute: async (input, context) => {
    const workflow = context.mastra.getWorkflow("myWorkflow");
    const run = await workflow.createRun();
    
    const result = await run.start({ inputData: input });
    
    if (result.status === "suspended") {
      return {
        status: "awaiting_approval",
        message: "Revisa los resultados...",
      };
    }
  },
});

// Tool 2: Reanuda el workflow
export const resumeTool = createTool({
  execute: async (input, context) => {
    // Buscar run suspendido automáticamente
    const workflow = context.mastra.getWorkflow("myWorkflow");
    const runs = await workflow.listWorkflowRuns({
      status: 'suspended',
      perPage: 1,
    });
    
    if (!runs.runs?.length) {
      throw new Error("No hay workflows pendientes");
    }
    
    const runId = runs.runs[0].runId;
    const run = await workflow.createRun({ runId });
    
    const result = await run.resume({
      step: "approval",
      resumeData: { approved: input.approved },
    });
    
    return result.result;
  },
});
```

---

## 4. Conexión de Componentes

### Registro en Mastra

```typescript
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

export const mastra = new Mastra({
  // Agentes disponibles
  agents: {
    contentAgent,
    coordinatorAgent,
  },
  
  // Workflows disponibles (para tools y agentes)
  workflows: {
    silenceCutterWorkflow,
  },
  
  // Storage necesario para HITL y memoria
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: "file:./mastra-memory.db",
  }),
});
```

### Jerarquía de Acceso

```
Mastra Instance
├── Agents
│   └── Tools
│       └── Workflow Access (via mastra.getWorkflow())
└── Workflows
    └── Steps
        └── Business Logic
```

---

## 5. Workspace

### Configuración

```typescript
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";

export const WORKSPACE_PATH = "/ruta/al/workspace";

export const workspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: WORKSPACE_PATH,
    readOnly: false,  // true = solo lectura, false = lectura/escritura
  }),
});
```

### Uso en Tools

```typescript
execute: async (input, context) => {
  // Acceso al workspace desde el contexto
  const { workspace } = context;
  
  // O importar directamente si es constante
  import { WORKSPACE_PATH } from "../workspace";
  const fullPath = path.join(WORKSPACE_PATH, input.file);
}
```

---

## 6. Buenas Prácticas

### Schemas
- ✅ **SIEMPRE** definir `inputSchema` y `outputSchema`
- ✅ Usar `.describe()` para documentar campos
- ✅ Validar tipos con Zod

### Manejo de Errores
```typescript
execute: async (input, context) => {
  try {
    const result = await operacionRiesgosa();
    return { success: true, data: result };
  } catch (error: any) {
    console.error("[ToolName] Error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}
```

### Logging
```typescript
console.log("[ToolName] Iniciando...");
console.log("[ToolName] Input:", input);
console.log("[ToolName] Error:", error.message);
```

### Validaciones
- Verificar existencia de archivos antes de procesar
- Validar que `mastra` existe en el contexto
- Comprobar resultados de operaciones externas (ffmpeg, APIs)

---

## 7. Ejemplo Completo: Silence Cutter

### Flujo
1. Usuario pide eliminar silencios
2. Tool inicia workflow → detecta silencios → suspende
3. Agente muestra resultados y pregunta
4. Usuario aprueba
5. Tool reanuda workflow → aplica cortes → genera archivo

### Código Resumido

```typescript
// Workflow con 3 steps
createWorkflow({ id: "silence-cutter", ... })
  .then(detectStep)    // Detecta silencios
  .then(approvalStep)  // Pausa para HITL
  .then(cutStep)       // Aplica cortes
  .commit();

// Tools que orquestan el workflow
const startTool = createTool({
  execute: async (input, { mastra }) => {
    const run = await mastra.getWorkflow("silence-cutter").createRun();
    const result = await run.start({ inputData: input });
    return { status: result.status, summary: result.steps["detect-silences"].output.summary };
  },
});

const resumeTool = createTool({
  execute: async (input, { mastra }) => {
    const runs = await mastra.getWorkflow("silence-cutter").listWorkflowRuns({ status: 'suspended' });
    const run = await workflow.createRun({ runId: runs.runs[0].runId });
    const result = await run.resume({ step: "approval", resumeData: input });
    return result.result;
  },
});

// Agente que usa las tools
new Agent({
  id: "content-agent",
  instructions: `Usa start-silence-cutter primero, luego resume-silence-cutter cuando el usuario apruebe`,
  tools: { startSilenceCutterTool, resumeSilenceCutterTool },
});
```

---

## Referencias

- **Embedded Docs**: `node_modules/@mastra/core/dist/docs/`
- **SOURCE_MAP**: `node_modules/@mastra/core/dist/docs/assets/SOURCE_MAP.json`
- **Mastra Studio**: http://localhost:4111 (para testing interactivo)

## Comandos Útiles

```bash
# Ver docs embebidas
ls node_modules/@mastra/core/dist/docs/references/

# Buscar tipos específicos
cat node_modules/@mastra/core/dist/docs/assets/SOURCE_MAP.json | grep '"Workflow"'

# Iniciar desarrollo
npm run dev
```
