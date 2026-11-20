import { tr } from "../i18n/language";

/* Official Payra Port Authority emblem (public/images/payra-logo.png). */
export function BrandMark() {
  return (
    <span className="ems-brandmark">
      <img src="/images/payra-logo.png" alt="" width={40} height={40} />
    </span>
  );
}

export function BrandBlock() {
  return (
    <>
      <BrandMark />
      <span className="ems-brand__copy">
        <strong>{tr("PAYRA PORT")}</strong>
        <small>{tr("EMPLOYEE MANAGEMENT")}</small>
      </span>
    </>
  );
}
