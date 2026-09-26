import { useCallback, useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";
import type { ISystemPromptSettingsService } from "@zcode/services";
import {
  BUILTIN_SYSTEM_PROMPT_SECTION_IDS,
  SYSTEM_PROMPT_CUSTOM_MAX_ENTRIES,
  type SystemPromptSettings,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import {
  BuiltinSystemPromptRow,
  CustomSystemPromptRow,
  SystemPromptEditor,
} from "./SystemPromptSettingsRows.js";
import {
  createCustomSystemPromptEntry,
  getBuiltinSystemPromptState,
  withBuiltinContent,
  withBuiltinEnabled,
  withBuiltinReset,
  withCustomRemoved,
  withCustomUpserted,
} from "./systemPromptSettingsDraft.js";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; settings: SystemPromptSettings; invalidFileError?: string };

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-ui-base font-medium text-foreground">{title}</h3>
      <p className="text-ui-base leading-6 text-foreground-subtle">{description}</p>
    </div>
  );
}

export function SystemPromptSettingsSection({
  service,
}: {
  service: ISystemPromptSettingsService | undefined;
}) {
  const { intl } = useZCodeIntl();
  const requestConfirmation = useConfirmDialog();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!service) return;
    setLoadState({ status: "loading" });
    try {
      const result = await service.getSettings();
      setLoadState({
        status: "ready",
        settings: result.settings,
        ...(result.status === "invalid" ? { invalidFileError: result.error } : {}),
      });
    } catch (error) {
      logger.error("[SystemPromptSettings] 读取系统提示词设置失败", { error });
      setLoadState({ status: "error", error: toErrorMessage(error) });
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: SystemPromptSettings): Promise<boolean> => {
      if (!service) return false;
      setSaving(true);
      setSaveError(null);
      try {
        const saved = await service.saveSettings(next);
        // 保存成功即写回了合法文件，之前的“文件损坏”提示不再成立。
        setLoadState({ status: "ready", settings: saved });
        return true;
      } catch (error) {
        logger.error("[SystemPromptSettings] 保存系统提示词设置失败", { error });
        setSaveError(toErrorMessage(error));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [service],
  );

  if (!service) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.systemPrompts.unavailable" })}
      </div>
    );
  }

  if (loadState.status === "loading") {
    return (
      <div className="px-4 py-8 text-center text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "common.loading" })}
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-ui-base">
        <p className="text-destructive">
          {intl.formatMessage(
            { id: "settings.systemPrompts.loadFailed" },
            { error: loadState.error },
          )}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          {intl.formatMessage({ id: "common.retry" })}
        </Button>
      </div>
    );
  }

  const { settings } = loadState;
  const customLimitReached = settings.custom.length >= SYSTEM_PROMPT_CUSTOM_MAX_ENTRIES;

  const handleDeleteCustom = async (id: string, title: string) => {
    const confirmed = await requestConfirmation({
      title: intl.formatMessage(
        { id: "settings.systemPrompts.custom.deleteConfirmTitle" },
        { title },
      ),
      description: intl.formatMessage({
        id: "settings.systemPrompts.custom.deleteConfirmDescription",
      }),
      confirmLabel: intl.formatMessage({ id: "settings.systemPrompts.delete" }),
      confirmVariant: "destructive",
    });
    if (confirmed) {
      await save(withCustomRemoved(settings, id));
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-ui-base leading-6 text-foreground-subtle">
        {intl.formatMessage({ id: "settings.systemPrompts.description" })}
      </p>

      {loadState.invalidFileError ? (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 px-3 py-2 text-ui-base text-warning"
        >
          {intl.formatMessage(
            { id: "settings.systemPrompts.invalidFile" },
            { error: loadState.invalidFileError },
          )}
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-ui-base text-destructive">
          {intl.formatMessage({ id: "settings.systemPrompts.saveFailed" }, { error: saveError })}
        </p>
      ) : null}

      <section className="space-y-3">
        <SectionHeading
          title={intl.formatMessage({ id: "settings.systemPrompts.builtin.title" })}
          description={intl.formatMessage({ id: "settings.systemPrompts.builtin.description" })}
        />
        <SettingsGroupCard>
          {BUILTIN_SYSTEM_PROMPT_SECTION_IDS.map((id) => (
            <BuiltinSystemPromptRow
              key={id}
              id={id}
              state={getBuiltinSystemPromptState(settings, id)}
              busy={saving}
              onToggle={(enabled) => void save(withBuiltinEnabled(settings, id, enabled))}
              onSaveContent={(content) => save(withBuiltinContent(settings, id, content))}
              onReset={() => void save(withBuiltinReset(settings, id))}
            />
          ))}
        </SettingsGroupCard>
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <SectionHeading
            title={intl.formatMessage({ id: "settings.systemPrompts.custom.title" })}
            description={intl.formatMessage({ id: "settings.systemPrompts.custom.description" })}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={saving || adding || customLimitReached}
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="size-3.5" />
            {intl.formatMessage({ id: "settings.systemPrompts.custom.add" })}
          </Button>
        </div>

        {adding ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <SystemPromptEditor
              initialContent=""
              showTitle
              busy={saving}
              onCancel={() => setAdding(false)}
              onSave={({ title, content }) => {
                void save(
                  withCustomUpserted(settings, createCustomSystemPromptEntry(title, content)),
                ).then((saved) => {
                  if (saved) setAdding(false);
                });
              }}
            />
          </div>
        ) : null}

        {settings.custom.length > 0 ? (
          <SettingsGroupCard>
            {settings.custom.map((entry) => (
              <CustomSystemPromptRow
                key={entry.id}
                entry={entry}
                busy={saving}
                onToggle={(enabled) =>
                  void save(withCustomUpserted(settings, { ...entry, enabled }))
                }
                onSave={({ title, content }) =>
                  save(withCustomUpserted(settings, { ...entry, title: title.trim(), content }))
                }
                onDelete={() =>
                  void handleDeleteCustom(
                    entry.id,
                    entry.title.trim() ||
                      intl.formatMessage({ id: "settings.systemPrompts.custom.untitled" }),
                  )
                }
              />
            ))}
          </SettingsGroupCard>
        ) : !adding ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.systemPrompts.custom.empty" })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
