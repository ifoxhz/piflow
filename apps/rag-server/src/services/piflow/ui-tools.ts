import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { CanvasArtifact, CanvasKind } from '@bluelamp/core';
import type { UiPresentInput } from './artifacts.js';

export const UI_TOOL_NAMES = ['ui_present'] as const;

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text' as const, text }],
    details,
  };
}

function parseKind(raw: string | undefined): CanvasKind | undefined {
  if (raw === 'table' || raw === 'kpis') return raw;
  return undefined;
}

export type CreateUiToolsOptions = {
  onPresent: (input: UiPresentInput) => CanvasArtifact | null;
};

export function createUiTools(options: CreateUiToolsOptions) {
  const uiPresent = defineTool({
    name: 'ui_present',
    label: 'Present on Canvas',
    description:
      'Update the Canvas summary (title, headline, outline). Host already opens a table from pg_query / kb list results — use this to set the interpretation, not to dump rows. Call after those tools. Do not paste large Markdown tables in chat.',
    parameters: Type.Object({
      artifactId: Type.Optional(
        Type.String({ description: 'Canvas artifact id from a prior tool (default: latest)' }),
      ),
      kind: Type.Optional(Type.String({ description: 'table | kpis (optional)' })),
      title: Type.Optional(Type.String({ description: 'Canvas panel title' })),
      headline: Type.Optional(Type.String({ description: 'One-sentence conclusion for the Summary Card' })),
      outline: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (_id, params) => {
      const artifact = options.onPresent({
        artifactId: params.artifactId?.trim() || undefined,
        kind: parseKind(params.kind?.trim()),
        title: params.title,
        headline: params.headline,
        outline: params.outline,
      });
      if (!artifact) {
        return textResult(
          'No canvas artifact yet. Run pg_query, kb_list_documents, or kb_search first; the host will open Canvas, then call ui_present to set headline/outline.',
          { ok: false },
        );
      }
      return textResult(
        JSON.stringify(
          {
            ok: true,
            id: artifact.id,
            revision: artifact.revision,
            title: artifact.title,
            headline: artifact.headline,
            outline: artifact.outline,
          },
          null,
          2,
        ),
        { ok: true, artifact },
      );
    },
  });

  return [uiPresent];
}
