import { useCallback } from "react";
import type { Attachment, CairnFeature } from "@cairn/types";
import { MediaView } from "../media/MediaView";
import { PhotoCapture } from "../media/PhotoCapture";
import { VideoCapture } from "../media/VideoCapture";
import { AudioRecorder } from "../media/AudioRecorder";

interface Props {
  feature: CairnFeature;
  onChange: (feature: CairnFeature) => void;
  onDelete: (id: string) => void;
}

export function FeatureEditor({ feature, onChange, onDelete }: Props): JSX.Element {
  const addAttachment = useCallback(
    (attachment: Attachment) => {
      onChange({
        ...feature,
        properties: {
          ...feature.properties,
          attachments: [...feature.properties.attachments, attachment],
        },
      });
    },
    [feature, onChange],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      onChange({
        ...feature,
        properties: {
          ...feature.properties,
          attachments: feature.properties.attachments.filter((a) => a.id !== id),
        },
      });
    },
    [feature, onChange],
  );

  return (
    <>
      <div className="field-row">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={feature.properties.title}
          onChange={(e) => onChange({ ...feature, properties: { ...feature.properties, title: e.target.value } })}
          placeholder="Short title"
        />
      </div>
      <div className="field-row">
        <label htmlFor="note">Notes</label>
        <textarea
          id="note"
          value={feature.properties.note}
          onChange={(e) => onChange({ ...feature, properties: { ...feature.properties, note: e.target.value } })}
          placeholder="What's here?"
        />
      </div>

      <div className="row">
        <PhotoCapture featureId={feature.properties.id} onAttached={addAttachment} />
        <VideoCapture featureId={feature.properties.id} onAttached={addAttachment} />
        <AudioRecorder featureId={feature.properties.id} onAttached={addAttachment} />
      </div>

      <div className="field-row">
        <label>Attachments ({feature.properties.attachments.length})</label>
        <div className="attachment-list">
          {feature.properties.attachments.map((a) => (
            <MediaView key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ color: "var(--muted)", fontSize: 12 }}>Feature metadata</summary>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
          <div>ID: {feature.properties.id}</div>
          <div>Created: {feature.properties.createdAt}</div>
          <div>Updated: {feature.properties.updatedAt}</div>
          <div>By: {feature.properties.createdBy}</div>
        </div>
      </details>

      <button className="danger" onClick={() => onDelete(feature.properties.id)}>
        Delete feature
      </button>
    </>
  );
}
