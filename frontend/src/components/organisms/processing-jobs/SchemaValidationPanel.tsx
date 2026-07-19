import { Stack, Group, Text, Badge, Alert, Paper, ScrollArea, Table } from '@mantine/core';
import { IconAlertTriangle, IconCircleX } from '@tabler/icons-react';
import StatusIcon from '../../atoms/StatusIcon';
import type {
  ExpectedSchema,
  SchemaFieldDefExtended,
  LegacySchemaFieldDef,
  ValidationResult,
  ValidationFieldResult,
} from './types';

/* ══════════════════════════════════════════════════════════════
   DYNAMIC RESPONSE SCHEMA VALIDATION
   Uses the job's config.expectedSchema instead of a hardcoded schema.
   ══════════════════════════════════════════════════════════════ */

/**
 * LEGACY: Kept for backward compatibility with jobs that don't yet have
 * an expectedSchema. Will be removed once all jobs are migrated.
 */
const ICP_SCHEMA_LEGACY = {
  name: {
    label: 'Company Name',
    type: 'single',
    required: true,
    allowedValues: null /* free-text */,
  },
  /* icp_type removed — shelved for re-evaluation */
  size: {
    label: 'Size',
    type: 'single',
    required: false,
    allowedValues: ['SOHO (Micro)', 'Small', 'Medium', 'MSE (Mid-Size Enterprise)', 'Enterprise', 'Large Enterprise'],
  },
  employee_range: {
    label: 'Employee Range',
    type: 'single',
    required: false,
    allowedValues: [
      '1–10 employees',
      '11–50 employees',
      '51–250 employees',
      '251–1,000 employees',
      '1,001–5,000 employees',
      '5,001+ employees',
    ],
  },
  revenue_range: {
    label: 'Revenue Range',
    type: 'single',
    required: false,
    allowedValues: ['$0 — <$1M', '$1M — <$10M', '$10M — <$50M', '$50M — <$500M', '$500M — <$1B', '$1B — <$5B', '$5B+'],
  },
  vertical: {
    label: 'Vertical',
    type: 'multi',
    required: false,
    allowedValues: [
      'Healthcare',
      'Financial Services',
      'Retail',
      'Manufacturing',
      'Technology',
      'Education',
      'Real Estate',
      'Hospitality',
      'Transportation & Logistics',
      'Energy & Utilities',
      'Media & Entertainment',
      'Professional Services',
      'Construction',
      'Agriculture',
      'Telecommunications',
      'Government',
    ],
  },
  sub_vertical: {
    label: 'Sub-Vertical',
    type: 'multi',
    required: false,
    allowedValues: [
      /* Healthcare */ 'Hospitals & Health Systems',
      'Clinics & Ambulatory',
      'Pharma',
      'Medical Devices',
      'Health IT',
      'Payer / Insurance',
      /* Financial Services */ 'Banking',
      'Insurance',
      'Capital Markets',
      'Fintech',
      'Wealth Management',
      /* Retail */ 'E-commerce',
      'Brick & Mortar',
      'Grocery',
      'Specialty Retail',
      'Luxury',
      /* Manufacturing */ 'Discrete',
      'Process',
      'Automotive',
      'Aerospace & Defense',
      'Consumer Goods',
      /* Technology */ 'SaaS',
      'Hardware',
      'IT Services',
      'Cybersecurity',
      'AI / ML',
      'MSP',
      'Distributor',
      /* Education */ 'K-12',
      'Higher Education',
      'EdTech',
      'Corporate Training',
      /* Real Estate */ 'Commercial',
      'Residential',
      'Property Management',
      'REITs',
      /* Hospitality */ 'Hotels & Resorts',
      'Restaurants & Food Service',
      'Travel & Tourism',
      'Events',
      /* Transportation */ 'Freight & Shipping',
      'Last Mile',
      'Fleet Management',
      'Warehousing',
      /* Energy */ 'Oil & Gas',
      'Renewables',
      'Electric Utilities',
      'Water',
      'Energy Broker',
      /* Media */ 'Streaming',
      'Gaming',
      'Publishing',
      'Advertising',
      /* Professional Services */ 'Consulting',
      'Legal',
      'Accounting',
      'Staffing',
      /* Construction */ 'General Contracting',
      'Engineering',
      'Architecture',
      /* Agriculture */ 'Farming',
      'AgTech',
      'Food Processing',
      /* Telecommunications */ 'Wireless',
      'ISP',
      'Infrastructure',
      'Major Telco',
      /* Government */ 'Federal',
      'State & Local',
      'Defense',
      'Civilian Agencies',
    ],
  },
  business_model: {
    label: 'Business Model',
    type: 'multi',
    required: false,
    allowedValues: ['B2B', 'B2C', 'Hybrid'],
  },
  num_locations: {
    label: 'Number of Locations',
    type: 'single',
    required: false,
    allowedValues: null /* free-text number */,
  },
  ownership_type: {
    label: 'Ownership Type',
    type: 'multi',
    required: false,
    allowedValues: ['Private', 'Public', 'PE Backed', 'Non-profit', 'Government'],
  },
  operating_region: {
    label: 'Operating Region',
    type: 'multi',
    required: false,
    allowedValues: ['Any', 'US', 'Canada', 'EMEA', 'Africa', 'APAC'],
  },
  software_type: {
    label: 'Software Type',
    type: 'multi',
    required: false,
    allowedValues: [
      'HCM',
      'ERP',
      'CRM',
      'SCM',
      'BI / Analytics',
      'Collaboration',
      'Security',
      'DevOps',
      'iPaaS / Integration',
      'Vertical SaaS',
      'Infrastructure',
      'Fintech',
      'Martech',
      'Healthtech',
      'Edtech',
    ],
  },
  cbis: {
    label: 'Critical Business Issues',
    type: 'multi',
    required: false,
    allowedValues: null /* suggested values but custom accepted */,
    suggestedValues: [
      'Revenue Growth',
      'Cost Reduction',
      'Digital Transformation',
      'Customer Experience',
      'Operational Efficiency',
      'Risk & Compliance',
      'Market Expansion',
      'Innovation',
      'Talent Acquisition & Retention',
      'Sustainability',
    ],
  },
  pain_points: {
    label: 'Pain Points',
    type: 'multi',
    required: false,
    allowedValues: null /* suggested values but custom accepted */,
    suggestedValues: [
      'Manual Processes',
      'Data Silos',
      'Poor Visibility / Reporting',
      'Scaling Challenges',
      'Integration Issues',
      'Compliance Burden',
      'Talent Shortage',
      'Legacy Systems',
      'Customer Churn',
      'Security Concerns',
    ],
  },
  tech_stack: {
    label: 'Tech Stack',
    type: 'multi',
    required: false,
    allowedValues: null /* suggested values but custom accepted */,
    suggestedValues: [
      'Salesforce',
      'SAP',
      'Oracle',
      'Microsoft 365',
      'AWS',
      'Azure',
      'GCP',
      'HubSpot',
      'Workday',
      'ServiceNow',
      'Snowflake',
      'Tableau',
      'Slack',
      'Jira',
      'NetSuite',
    ],
  },
  tech_products_sold: {
    label: 'Tech Products Sold',
    type: 'multi',
    required: false,
    allowedValues: [
      'Connectivity',
      'Mobile',
      'CX',
      'SaaS',
      'AI',
      'Infrastructure',
      'Security',
      'Services',
      'Hardware',
      'Energy',
    ],
  },
  other_criteria: {
    label: 'Other Criteria',
    type: 'multi',
    required: false,
    allowedValues: null /* free-text tags */,
  },
  fortune_rank: {
    label: 'Fortune Rank',
    type: 'single',
    required: false,
    allowedValues: null,
  },
  ticker_symbol: {
    label: 'Ticker Symbol',
    type: 'single',
    required: false,
    allowedValues: null,
  },
  stock_exchange: {
    label: 'Stock Exchange',
    type: 'single',
    required: false,
    allowedValues: null,
  },
  locations: {
    label: 'Locations',
    type: 'multi',
    required: false,
    allowedValues: null,
  },
  general_contact: {
    label: 'General Contact',
    type: 'single',
    required: false,
    allowedValues: null,
  },
};

/**
 * Convert a job's expectedSchema fields into the legacy ICP_SCHEMA format
 * so the validator can handle both old and new field definitions uniformly.
 * Maps schema types: 'array' → 'multi', everything else → 'single'.
 */
function normaliseSchemaFields(expectedSchema: ExpectedSchema | null | undefined) {
  const fields = expectedSchema?.fields || {};
  const normalised: Record<string, LegacySchemaFieldDef> = {};
  for (const [name, def] of Object.entries(fields) as [string, SchemaFieldDefExtended][]) {
    normalised[name] = {
      label: def.description || name,
      type: def.type === 'array' ? 'multi' : 'single',
      required: !!def.required,
      allowedValues: def.allowedValues || null,
      suggestedValues: def.suggestedValues || null,
    };
  }
  return normalised;
}

/**
 * Validate a parsed JSON object against the response schema.
 * Uses the job's dynamic expectedSchema if provided, otherwise
 * falls back to the legacy ICP_SCHEMA_LEGACY for backward compat.
 *
 * @param {string} formattedText — raw AI response text
 * @param {object|null} expectedSchema — job's config.expectedSchema
 * @returns {{ valid, parseError, fields, summary, unexpectedFields }}
 */
function validateResponseSchema(
  formattedText: string,
  expectedSchema: ExpectedSchema | null | undefined,
): ValidationResult {
  /* Determine which schema fields to use */
  const hasExpectedSchema = expectedSchema && Object.keys(expectedSchema.fields || {}).length > 0;
  const schemaToUse = hasExpectedSchema ? normaliseSchemaFields(expectedSchema) : ICP_SCHEMA_LEGACY;

  const result: ValidationResult = {
    valid: false,
    parseError: null as string | null,
    fields: [] as ValidationFieldResult[],
    summary: { total: 0, passed: 0, warnings: 0, errors: 0, missing: 0 },
    unexpectedFields: [] as string[],
  };

  /* Try to parse the formatted text as JSON */
  let parsed;
  try {
    parsed = JSON.parse(formattedText);
  } catch (err: unknown) {
    result.parseError = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  /* Check if it's an object (not an array or primitive) */
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    result.parseError = `Expected a JSON object but got ${Array.isArray(parsed) ? 'array' : typeof parsed}`;
    return result;
  }

  const schemaKeys = Object.keys(schemaToUse);
  const parsedKeys = Object.keys(parsed);

  /* Detect unexpected (extra) fields not in the schema */
  result.unexpectedFields = parsedKeys.filter((k) => !schemaKeys.includes(k));

  /* Validate each expected field */
  for (const [fieldName, fieldDef] of Object.entries(schemaToUse) as [string, LegacySchemaFieldDef][]) {
    const fieldResult: ValidationFieldResult & { present: boolean; value: unknown } = {
      field: fieldName,
      label: fieldDef.label,
      required: fieldDef.required,
      expectedType: fieldDef.type,
      present: fieldName in parsed,
      value: parsed[fieldName] ?? null,
      status: 'pass',
      issues: [] as string[],
    };

    result.summary.total++;

    /* Check presence */
    if (!fieldResult.present || fieldResult.value === null || fieldResult.value === undefined) {
      if (fieldDef.required) {
        fieldResult.status = 'error';
        fieldResult.issues.push('Required field is missing or null');
        result.summary.errors++;
      } else {
        fieldResult.status = 'warning';
        fieldResult.issues.push('Field is missing or null (optional)');
        result.summary.missing++;
      }
      result.fields.push(fieldResult);
      continue;
    }

    /* Type check: multi fields should be arrays, single fields should be strings */
    const val = fieldResult.value;

    if (fieldDef.type === 'multi') {
      if (!Array.isArray(val)) {
        /* Accept semicolon-separated strings as well */
        if (typeof val === 'string') {
          fieldResult.issues.push('Expected array but got string (semicolon-separated may be acceptable)');
          fieldResult.status = 'warning';
          result.summary.warnings++;
          /* Still validate allowed values by splitting */
          if (fieldDef.allowedValues) {
            const allowed = fieldDef.allowedValues;
            const parts = val.split(';').map((s) => s.trim());
            const invalid = parts.filter((p) => p && !allowed.includes(p));
            if (invalid.length > 0) {
              fieldResult.issues.push(`Non-allowed values: ${invalid.join(', ')}`);
              fieldResult.status = 'error';
              result.summary.errors++;
              result.summary.warnings--; /* upgrade from warning to error */
            }
          }
          result.fields.push(fieldResult);
          continue;
        } else {
          fieldResult.status = 'error';
          fieldResult.issues.push(`Expected array but got ${typeof val}`);
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Validate allowed values for array items */
      if (fieldDef.allowedValues) {
        const allowed = fieldDef.allowedValues;
        const invalid = val.filter((v) => typeof v === 'string' && !allowed.includes(v));
        if (invalid.length > 0) {
          fieldResult.issues.push(`Non-allowed values: ${invalid.join(', ')}`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Check if suggested values — flag non-standard but don't mark as error */
      if (fieldDef.suggestedValues && Array.isArray(val)) {
        const suggested = fieldDef.suggestedValues;
        const nonStandard = val.filter((v) => typeof v === 'string' && !suggested.includes(v));
        if (nonStandard.length > 0) {
          fieldResult.issues.push(`Custom values (not in suggested list): ${nonStandard.join(', ')}`);
          /* Custom values are acceptable for these fields, so keep as pass */
        }
      }
    } else if (fieldDef.type === 'single') {
      if (typeof val !== 'string' && typeof val !== 'number') {
        /* Arrays are not acceptable for single-value fields */
        if (Array.isArray(val)) {
          fieldResult.issues.push('Expected single value but got array');
          fieldResult.status = 'warning';
          result.summary.warnings++;
        } else {
          fieldResult.issues.push(`Expected string but got ${typeof val}`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Validate against allowed values */
      if (fieldDef.allowedValues && typeof val === 'string') {
        if (!fieldDef.allowedValues.includes(val)) {
          fieldResult.issues.push(`Value "${val}" not in allowed list`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }
    }

    if (fieldResult.status === 'pass') {
      result.summary.passed++;
    }
    result.fields.push(fieldResult);
  }

  result.valid = result.summary.errors === 0 && !result.parseError;
  return result;
}
/* ══════════════════════════════════════════════════════════════
   SCHEMA VALIDATION PANEL
   ══════════════════════════════════════════════════════════════ */

/**
 * Validates the formatted LLM response against the job's expected response
 * schema and renders a field-by-field report with pass/warning/error indicators.
 */
export default function SchemaValidationPanel({
  formattedText,
  expectedSchema,
}: {
  formattedText: string;
  expectedSchema: ExpectedSchema | null | undefined;
}) {
  if (!formattedText) return null;

  const validation = validateResponseSchema(formattedText, expectedSchema);

  /** Format a field value for display (truncate long arrays/strings) */
  function formatValue(val: unknown) {
    if (val === null || val === undefined)
      return (
        <Text size="xs" c="dimmed" fs="italic">
          null
        </Text>
      );
    if (Array.isArray(val)) {
      return (
        <Group gap={4} wrap="wrap">
          {val.map((v, i) => (
            <Badge key={i} size="xs" variant="outline" color="gray">
              {String(v)}
            </Badge>
          ))}
        </Group>
      );
    }
    const str = String(val);
    if (str.length > 80)
      return (
        <Text size="xs" style={{ wordBreak: 'break-word' }}>
          {str.slice(0, 80)}…
        </Text>
      );
    return (
      <Text size="xs" style={{ wordBreak: 'break-word' }}>
        {str}
      </Text>
    );
  }

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600} size="sm">
          Schema Validation
        </Text>
        {validation.parseError ? (
          <Badge color="red" variant="filled" size="sm">
            JSON Parse Error
          </Badge>
        ) : (
          <Group gap="xs">
            <Badge color={validation.valid ? 'green' : 'red'} variant="filled" size="sm">
              {validation.valid ? 'Valid' : 'Issues Found'}
            </Badge>
            <Badge color="green" variant="light" size="xs">
              {validation.summary.passed} passed
            </Badge>
            {validation.summary.warnings > 0 && (
              <Badge color="yellow" variant="light" size="xs">
                {validation.summary.warnings} warnings
              </Badge>
            )}
            {validation.summary.errors > 0 && (
              <Badge color="red" variant="light" size="xs">
                {validation.summary.errors} errors
              </Badge>
            )}
            {validation.summary.missing > 0 && (
              <Badge color="gray" variant="light" size="xs">
                {validation.summary.missing} empty
              </Badge>
            )}
          </Group>
        )}
      </Group>

      {/* Parse error — stop here */}
      {validation.parseError && (
        <Alert color="red" variant="light" icon={<IconCircleX size={16} />}>
          <Text size="sm">{validation.parseError}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            The formatted response could not be parsed as JSON. Check the formatting rules or the AI prompt to ensure
            valid JSON output.
          </Text>
        </Alert>
      )}

      {/* Unexpected extra fields */}
      {validation.unexpectedFields.length > 0 && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />} mb="sm">
          <Text size="sm" fw={500}>
            Unexpected fields in response
          </Text>
          <Text size="xs" c="dimmed">
            The following fields are not part of the expected response schema and may be ignored:{' '}
            {validation.unexpectedFields.map((f: string) => (
              <Badge key={f} size="xs" variant="outline" color="yellow" mx={2}>
                {f}
              </Badge>
            ))}
          </Text>
        </Alert>
      )}

      {/* Field-by-field table */}
      {!validation.parseError && (
        <ScrollArea>
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            verticalSpacing={4}
            style={{ fontSize: 12 }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 30 }}></Table.Th>
                <Table.Th style={{ width: 160 }}>Field</Table.Th>
                <Table.Th style={{ width: 70 }}>Type</Table.Th>
                <Table.Th>Value</Table.Th>
                <Table.Th style={{ width: 250 }}>Issues</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {validation.fields.map((f) => (
                <Table.Tr key={f.field}>
                  <Table.Td>
                    <StatusIcon status={f.status} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Text size="xs" fw={500}>
                        {f.label}
                      </Text>
                      {f.required && (
                        <Badge size="xs" color="red" variant="light">
                          req
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {f.field}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={f.expectedType === 'multi' ? 'violet' : 'blue'}>
                      {f.expectedType}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatValue(f.value)}</Table.Td>
                  <Table.Td>
                    {f.issues.length > 0 ? (
                      <Stack gap={2}>
                        {f.issues.map((issue: string, i: number) => (
                          <Text
                            key={i}
                            size="xs"
                            c={f.status === 'error' ? 'red' : f.status === 'warning' ? 'yellow.8' : 'dimmed'}
                          >
                            {issue}
                          </Text>
                        ))}
                      </Stack>
                    ) : (
                      <Text size="xs" c="green">
                        OK
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Paper>
  );
}
