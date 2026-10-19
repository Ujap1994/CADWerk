import type { SolverRequestMessage, SolverResponseMessage } from './protocol.ts';
import { isRedundant, solveSketch } from './solver/index.ts';

/** Runs one solver request; never throws (errors become error replies). */
export function handleSolverRequest(message: SolverRequestMessage): SolverResponseMessage {
  try {
    switch (message.type) {
      case 'solve': {
        const options = message.drag ? { drag: message.drag, analyze: message.analyze } : { analyze: message.analyze };
        return { id: message.id, ok: true, result: solveSketch(message.sketch, options) };
      }
      case 'redundant':
        return { id: message.id, ok: true, result: isRedundant(message.sketch.entities, message.sketch.constraints, message.candidate) };
    }
  } catch (error) {
    return { id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
