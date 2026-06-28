# Prompt Frameworks

## COSTAR

```
Context: [Background information the model needs]
Objective: [Specific task or goal]
Style: [Writing style — formal, technical, conversational]
Tone: [Emotional tone — professional, empathetic, authoritative]
Audience: [Who will read the output]
Response: [Exact format — JSON schema, bullet list, paragraph]
```

**Best for:** Processing job templates with clear output requirements.

## RTF (Role-Task-Format)

```
Role: You are a senior market analyst specializing in B2B SaaS.
Task: Evaluate the credibility of the following sources for TAM analysis.
Format: JSON with fields: evaluations[], trusted_sources[]
```

**Best for:** Quick single-step jobs.

## CRISPE

```
Capacity/Role: Expert code reviewer
Insight: Focus on security vulnerabilities in user input handling
Statement: Review the following code snippet
Personality: Direct and actionable
Experiment: Provide specific fixes, not general advice
```

**Best for:** Analysis and review tasks.

## JSON output wrapper (AI Admin standard)

Append to any framework when using `outputMappings`:

```
[Framework body above]

IMPORTANT: Respond with ONLY the following JSON object.
Do not include markdown code fences, explanations, or any text outside the JSON.
{
  "field_name": "value matching outputMappings key"
}
```

Set job config: `"expectedResponseFormat": "json"`
