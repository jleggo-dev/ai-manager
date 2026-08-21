-- 014 — a workflow step that asks the user, instead of asking a model.
--
-- The workflow engine works and is tested: each step sends its job to an LLM, the reply's declared
-- `outputMappings` are captured into `workflow_variables`, `workflow.step.completed` fires, and the
-- next step composes its prompt from those variables through `inputMappings`. What it could not
-- express was a step where the ANSWER COMES FROM THE PERSON. `processing_job_id` was NOT NULL, so
-- "show the user what we read off their photo and let them correct it" had to be faked as a model
-- round-trip that does nothing but pose a question — paying for a call to produce a sentence the
-- app could have written itself, and putting that sentence in a prompt template instead of in the
-- app's own voice.
--
-- Which is the shape two-stage photo logging needs (owner, 2026-08-21): read the photo -> SHOW THE
-- READING AND ASK -> convert to numbers. "AI, ask, AI". The middle step is this.
--
-- Everything else was already here. A session carries `workflow_variables`; a user message already
-- tags its `workflow_step_id`, which is how step completion has always been counted; and
-- `workflow.step.completed` already fires. This adds a step KIND and relaxes one NOT NULL.

alter table public.workflow_steps
  add column if not exists step_type text not null default 'job';

alter table public.workflow_steps
  drop constraint if exists workflow_steps_step_type_check;
alter table public.workflow_steps
  add constraint workflow_steps_step_type_check check (step_type in ('job', 'input'));

-- Nullable ONLY for input steps. The paired check below keeps the old guarantee exactly where it
-- still applies: a job step without a job was, and remains, impossible.
alter table public.workflow_steps
  alter column processing_job_id drop not null;

alter table public.workflow_steps
  drop constraint if exists workflow_steps_job_required_for_job_type;
alter table public.workflow_steps
  add constraint workflow_steps_job_required_for_job_type check (
    (step_type = 'job' and processing_job_id is not null)
    or (step_type = 'input' and processing_job_id is null)
  );

comment on column public.workflow_steps.step_type is
  'job = send this step''s processing job to the LLM (the default, and every step that existed before 2026-08-21). input = pause and collect an answer from the user; the answer is merged into workflow_variables under config.collects and the step completes with no model call.';
