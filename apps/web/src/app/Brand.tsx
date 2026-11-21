import { tr } from "../i18n/language";

export function BrandMark() {
  return (
    <span className="ems-brandmark">
      <img src="/images/dumb-ems.svg" alt="brand-logo" />
    </span>
  );
}

export function BrandBlock() {
  return (
    <>
      <BrandMark />
      <span className="ems-brand__copy">
        <small>{tr("Employee management")}</small>
      </span>
    </>
  );
}
