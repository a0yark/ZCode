import { useState } from "react";
import { PencilIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import {
  SYSTEM_PROMPT_CONTENT_MAX_CHARS,
  SYSTEM_PROMPT_CUSTOM_TITLE_MAX_CHARS,
  type BuiltinSystemPromptSectionId,
  type CustomSystemPromptEntry,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { BuiltinSystemPromptState } from "./systemPromptSettingsDraft.js";

function StatusTag({ children }: { children: string }) {
  return (
    <span className="ml-2 inline-flex h-5 shrink-0 items-center rounded-md bg-surface px-1.5 text-ui-xs font-medium text-foreground-subtle">
      {children}
    </span>
  );
}

export function SystemPromptEditor({
  initialTitle,
  initialContent,
  showTitle,
  busy,
  onSave,
  onCancel,
}: {
  initialTitle?: string;
  initialContent: string;
  showTitle: boolean;
  busy: boolean;
  onSave: (value: { title: string; content: string }) => void;
  onCancel: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [content, setContent] = useState(initialContent);
  const contentTooLong = content.length > SYSTEM_PROMPT_CONTENT_MAX_CHARS;
  const contentEmpty = content.trim().length === 0;
  const error = contentTooLong
    ? intl.formatMessage(
        { id: "settings.systemPrompts.contentTooLong" },
        { max: SYSTEM_PROMPT_CONTENT_MAX_CHARS },
      )
    : null;

  return (
    <div className="space-y-2">
      {showTitle ? (
        <Input
          value={title}
          maxLength={SYSTEM_PROMPT_CUSTOM_TITLE_MAX_CHARS}
          placeholder={intl.formatMessage({ id: "settings.systemPrompts.custom.titlePlaceholder" })}
          aria-label={intl.formatMessage({ id: "settings.systemPrompts.custom.titlePlaceholder" })}
          onChange={(event) => setTitle(event.target.value)}
        />
      ) : null}
      <Textarea
        value={content}
        rows={8}
        className="max-h-96 min-h-32 overflow-y-auto font-mono"
        placeholder={intl.formatMessage({ id: "settings.systemPrompts.custom.contentPlaceholder" })}
        aria-label={intl.formatMessage({ id: "settings.systemPrompts.custom.contentPlaceholder" })}
        aria-invalid={contentTooLong || undefined}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={error ? "text-ui-sm text-destructive" : "text-ui-sm text-foreground-subtlest"}
        >
          {error ?? `${content.length} / ${SYSTEM_PROMPT_CONTENT_MAX_CHARS}`}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            {intl.formatMessage({ id: "settings.systemPrompts.cancel" })}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || contentTooLong || contentEmpty}
            onClick={() => onSave({ title, content })}
          >
            {intl.formatMessage({ id: "settings.systemPrompts.save" })}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BuiltinSystemPromptRow({
  id,
  state,
  busy,
  onToggle,
  onSaveContent,
  onReset,
}: {
  id: BuiltinSystemPromptSectionId;
  state: BuiltinSystemPromptState;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onSaveContent: (content: string) => Promise<boolean>;
  onReset: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [editing, setEditing] = useState(false);
  const title = intl.formatMessage({ id: `settings.systemPrompts.section.${id}.title` });

  return (
    <div className="border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center text-ui-base font-medium text-foreground">
            <span className="truncate">{title}</span>
            {state.modified ? (
              <StatusTag>{intl.formatMessage({ id: "settings.systemPrompts.modified" })}</StatusTag>
            ) : null}
            {!state.enabled ? (
              <StatusTag>{intl.formatMessage({ id: "settings.systemPrompts.disabled" })}</StatusTag>
            ) : null}
          </div>
          <div className="mt-1 text-ui-base leading-6 text-foreground-subtle">
            {intl.formatMessage({ id: `settings.systemPrompts.section.${id}.description` })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {state.modified ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={intl.formatMessage({ id: "settings.systemPrompts.reset" })}
              title={intl.formatMessage({ id: "settings.systemPrompts.reset" })}
              onClick={onReset}
            >
              <RotateCcwIcon className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={intl.formatMessage({ id: "settings.systemPrompts.edit" })}
            title={intl.formatMessage({ id: "settings.systemPrompts.edit" })}
            onClick={() => setEditing((value) => !value)}
          >
            <PencilIcon className="size-4" />
          </Button>
          <Switch
            className="ml-2"
            checked={state.enabled}
            disabled={busy}
            aria-label={intl.formatMessage(
              { id: "settings.systemPrompts.enableToggle" },
              { name: title },
            )}
            onCheckedChange={onToggle}
          />
        </div>
      </div>
      {editing ? (
        <div className="mt-3">
          <SystemPromptEditor
            initialContent={state.content}
            showTitle={false}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={({ content }) => {
              void onSaveContent(content).then((saved) => {
                if (saved) setEditing(false);
              });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function CustomSystemPromptRow({
  entry,
  busy,
  onToggle,
  onSave,
  onDelete,
}: {
  entry: CustomSystemPromptEntry;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onSave: (value: { title: string; content: string }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [editing, setEditing] = useState(false);
  const title =
    entry.title.trim() || intl.formatMessage({ id: "settings.systemPrompts.custom.untitled" });

  return (
    <div className="border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center text-ui-base font-medium text-foreground">
            <span className="truncate">{title}</span>
            {!entry.enabled ? (
              <StatusTag>{intl.formatMessage({ id: "settings.systemPrompts.disabled" })}</StatusTag>
            ) : null}
          </div>
          {!editing ? (
            <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-ui-base leading-6 text-foreground-subtle">
              {entry.content}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={intl.formatMessage({ id: "settings.systemPrompts.edit" })}
            title={intl.formatMessage({ id: "settings.systemPrompts.edit" })}
            onClick={() => setEditing((value) => !value)}
          >
            <PencilIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={intl.formatMessage({ id: "settings.systemPrompts.delete" })}
            title={intl.formatMessage({ id: "settings.systemPrompts.delete" })}
            onClick={onDelete}
          >
            <Trash2Icon className="size-4" />
          </Button>
          <Switch
            className="ml-2"
            checked={entry.enabled}
            disabled={busy}
            aria-label={intl.formatMessage(
              { id: "settings.systemPrompts.enableToggle" },
              { name: title },
            )}
            onCheckedChange={onToggle}
          />
        </div>
      </div>
      {editing ? (
        <div className="mt-3">
          <SystemPromptEditor
            initialTitle={entry.title}
            initialContent={entry.content}
            showTitle
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={(value) => {
              void onSave(value).then((saved) => {
                if (saved) setEditing(false);
              });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
