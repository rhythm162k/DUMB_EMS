import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sections, type Field, type Section } from "./pds-fields";
import { apiRequest } from "../../lib/api";

type Spouse = {
  id: string;
  spouseName: string;
  spouseOccupation: string | null;
  spouseDateOfBirth: string | null;
  spouseNationalId: string | null;
};
type Department = { id: string; nameEn: string; nameBn: string | null };
type PdsRecord = { id: string; [key: string]: string | number | null };
const blank = (fields: Field[]) =>
  Object.fromEntries(fields.map((field) => [field.key, ""])) as Record<
    string,
    string
  >;
const asText = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

function RecordEditor({
  employeeId,
  section,
  departments,
  record,
  onClose,
}: {
  employeeId: string;
  section: Section;
  departments: Department[];
  record: PdsRecord | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    blank(section.fields),
  );
  useEffect(() => {
    setValues(
      record
        ? Object.fromEntries(
            section.fields.map((field) => [
              field.key,
              asText(record[field.key]),
            ]),
          )
        : blank(section.fields),
    );
  }, [record, section]);
  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const field of section.fields) {
        const value = values[field.key].trim();
        if (field.type === "number")
          payload[field.key] = value ? Number(value) : null;
        else if (value) payload[field.key] = value;
        else if (record) payload[field.key] = null;
      }
      return apiRequest(
        `/admin/employees/${employeeId}/records/${section.slug}${record ? `/${record.id}` : ""}`,
        { method: record ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["employee", employeeId],
      });
      onClose();
    },
  });
  return (
    <form
      className="pds-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="form-grid">
        {section.fields.map((field) => (
          <label
            key={field.key}
            className={field.wide ? "form-field-wide" : ""}
          >
            {tr(field.label)}
            {field.type === "textarea" ? (
              <textarea
                rows={3}
                maxLength={2000}
                required={field.required}
                value={values[field.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            ) : field.type === "department" ? (
              <select
                value={values[field.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              >
                <option value="">{tr("No department")}</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.nameEn}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  field.type === "number" ? "number" : (field.type ?? "text")
                }
                min={field.type === "number" ? 1900 : undefined}
                max={
                  field.type === "number"
                    ? new Date().getFullYear() + 1
                    : undefined
                }
                maxLength={field.type === "number" ? undefined : 300}
                required={field.required}
                value={values[field.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            )}
          </label>
        ))}
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          {tr(safeError(save.error))}
        </p>
      )}
      <div className="form-actions">
        <button
          className="auth-submit form-submit"
          type="submit"
          disabled={save.isPending}
        >
          {tr(
            save.isPending ? "Saving…" : record ? "Save record" : "Add record",
          )}
        </button>
        <button
          className="secondary-link-button"
          type="button"
          onClick={onClose}
        >
          {tr("Cancel")}
        </button>
      </div>
    </form>
  );
}

function SpousePanel({
  employeeId,
  spouse,
  married,
}: {
  employeeId: string;
  spouse: Spouse | null;
  married: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    spouseName: "",
    spouseOccupation: "",
    spouseDateOfBirth: "",
    spouseNationalId: "",
  });
  useEffect(() => {
    setValues({
      spouseName: spouse?.spouseName ?? "",
      spouseOccupation: spouse?.spouseOccupation ?? "",
      spouseDateOfBirth: spouse?.spouseDateOfBirth ?? "",
      spouseNationalId: spouse?.spouseNationalId ?? "",
    });
  }, [spouse]);
  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/admin/employees/${employeeId}/spouse`, {
        method: "PUT",
        body: JSON.stringify({
          ...values,
          spouseOccupation: values.spouseOccupation || null,
          spouseDateOfBirth: values.spouseDateOfBirth || null,
          spouseNationalId: values.spouseNationalId || null,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["employee", employeeId],
      });
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      apiRequest(`/admin/employees/${employeeId}/spouse`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["employee", employeeId],
      });
      setEditing(false);
    },
  });
  if (!married)
    return (
      <div className="pds-empty">
        {tr(
          "To add spouse information, first set marital status to Married in personal details.",
        )}
      </div>
    );
  return (
    <div className="pds-panel">
      <div className="pds-panel-heading">
        <div>
          <h3>{tr("Spouse information")}</h3>
          <p>{tr("One spouse record per employee.")}</p>
        </div>
        {!editing && (
          <button
            className="secondary-link-button"
            type="button"
            onClick={() => setEditing(true)}
          >
            {tr(spouse ? "Edit spouse" : "Add spouse")}
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="pds-editor"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="form-grid">
            <label>
              {tr("Spouse name *")}
              <input
                required
                maxLength={200}
                value={values.spouseName}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    spouseName: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              {tr("Occupation")}
              <input
                maxLength={150}
                value={values.spouseOccupation}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    spouseOccupation: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              {tr("Date of birth")}
              <input
                type="date"
                value={values.spouseDateOfBirth}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    spouseDateOfBirth: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              {tr("National ID")}
              <input
                maxLength={30}
                value={values.spouseNationalId}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    spouseNationalId: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          {save.isError && (
            <p className="form-error" role="alert">
              {tr(safeError(save.error))}
            </p>
          )}
          <div className="form-actions">
            <button
              className="auth-submit form-submit"
              type="submit"
              disabled={save.isPending}
            >
              {tr(save.isPending ? "Saving…" : "Save spouse")}
            </button>
            <button
              className="secondary-link-button"
              type="button"
              onClick={() => setEditing(false)}
            >
              {tr("Cancel")}
            </button>
          </div>
        </form>
      ) : spouse ? (
        <div className="pds-record-grid">
          {[
            ["Name", spouse.spouseName],
            ["Occupation", spouse.spouseOccupation],
            ["Date of birth", spouse.spouseDateOfBirth],
            ["National ID", spouse.spouseNationalId],
          ].map(([label, value]) => (
            <div className="profile-field" key={label}>
              <span>{tr(label)}</span>
              <strong>{value || "—"}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="pds-empty">{tr("No spouse record has been added.")}</p>
      )}
      {remove.isError && (
        <p className="form-error" role="alert">
          {tr(safeError(remove.error))}
        </p>
      )}
      {spouse && !editing && (
        <button
          className="pds-delete"
          type="button"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm("Delete this spouse record?")) remove.mutate();
          }}
        >
          {tr("Delete spouse record")}
        </button>
      )}
    </div>
  );
}

export default function EmployeePdsPanel({
  employeeId,
  maritalStatus,
  records,
  spouse,
  departments,
}: {
  employeeId: string;
  maritalStatus: string | null;
  records: Record<string, PdsRecord[]>;
  spouse: Spouse | null;
  departments: Department[];
}) {
  const [activeSlug, setActiveSlug] = useState(sections[0].slug);
  const [editingRecord, setEditingRecord] = useState<PdsRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();
  const active = useMemo(
    () =>
      sections.find((section) => section.slug === activeSlug) ?? sections[0],
    [activeSlug],
  );
  const items = records[active.responseKey] ?? [];
  const remove = useMutation({
    mutationFn: (recordId: string) =>
      apiRequest(
        `/admin/employees/${employeeId}/records/${active.slug}/${recordId}`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["employee", employeeId] }),
  });
  return (
    <div className="pds-workspace">
      <SpousePanel
        employeeId={employeeId}
        spouse={spouse}
        married={maritalStatus === "MARRIED"}
      />
      <section
        id="record-service"
        className="pds-panel record-section-target"
        tabIndex={-1}
      >
        <div className="pds-panel-heading">
          <div>
            <h3>{tr("Personal and service records")}</h3>
            <p>
              {tr(
                "Add or update the employee's education, training and service history.",
              )}
            </p>
          </div>
        </div>
        <div
          className="pds-tabs"
          role="tablist"
          aria-label={tr("Record sections")}
        >
          {sections.map((section) => (
            <button
              type="button"
              role="tab"
              aria-selected={active.slug === section.slug}
              className={
                active.slug === section.slug
                  ? "pds-tab pds-tab-active"
                  : "pds-tab"
              }
              key={section.slug}
              onClick={() => {
                setActiveSlug(section.slug);
                setAdding(false);
                setEditingRecord(null);
              }}
            >
              {tr(section.title)}
            </button>
          ))}
        </div>
        <div className="pds-section-heading">
          <div>
            <h4>{active.title}</h4>
            <p>{active.description}</p>
          </div>
          {!adding && !editingRecord && (
            <button
              className="primary-link-button"
              type="button"
              onClick={() => setAdding(true)}
            >
              {tr("Add record")}
            </button>
          )}
        </div>
        {(adding || editingRecord) && (
          <RecordEditor
            key={`${active.slug}-${editingRecord?.id ?? "new"}`}
            employeeId={employeeId}
            section={active}
            departments={departments}
            record={editingRecord}
            onClose={() => {
              setAdding(false);
              setEditingRecord(null);
            }}
          />
        )}
        {!adding &&
          !editingRecord &&
          (items.length ? (
            <div className="pds-record-list">
              {items.map((record) => (
                <article className="pds-record-card" key={record.id}>
                  <div className="pds-record-values">
                    {active.fields.map((field) => (
                      <div key={field.key}>
                        <span>{tr(field.label)}</span>
                        <strong>
                          {record[field.key] === null ||
                          record[field.key] === undefined ||
                          record[field.key] === ""
                            ? "—"
                            : String(record[field.key])}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div className="pds-record-actions">
                    <button
                      type="button"
                      onClick={() => setEditingRecord(record)}
                    >
                      {tr("Edit")}
                    </button>
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm("Delete this service record?"))
                          remove.mutate(record.id);
                      }}
                    >
                      {tr("Delete")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="pds-empty">
              {tr("No records have been added to this section.")}
            </p>
          ))}
        {remove.isError && (
          <p className="form-error" role="alert">
            {tr(safeError(remove.error))}
          </p>
        )}
      </section>
    </div>
  );
}
