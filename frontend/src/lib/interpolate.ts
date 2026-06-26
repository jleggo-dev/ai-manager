/**
 * Client-side template interpolation — mirrors backend interpolateTemplate()
 * without the prompt-armoring XML wrappers (those are server-side only).
 */

const PLACEHOLDER_RE = /\{\{([\w.-]+)\}\}/g;

export interface InterpolationResult {
  text: string;
  usedKeys: string[];
  missingKeys: string[];
}

export function interpolateTemplate(template: string, variables: Record<string, string>): InterpolationResult {
  const usedKeys: string[] = [];
  const missingKeys: string[] = [];

  const text = template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (key in variables && variables[key] !== undefined) {
      usedKeys.push(key);
      return variables[key];
    }
    missingKeys.push(key);
    return match;
  });

  return { text, usedKeys, missingKeys };
}

export function extractPlaceholders(template: string): string[] {
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  while ((m = re.exec(template)) !== null) {
    if (m[1] && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

/**
 * Apply inputMappings to translate workflow-level variables into
 * job-level variable names. Caller-provided vars override mapped ones.
 */
export function applyInputMappings(
  inputMappings: Record<string, string>,
  accumulated: Record<string, string>,
  callerVars: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [jobVar, workflowVar] of Object.entries(inputMappings)) {
    if (accumulated[workflowVar] !== undefined) {
      result[jobVar] = accumulated[workflowVar];
    }
  }
  return { ...result, ...callerVars };
}
