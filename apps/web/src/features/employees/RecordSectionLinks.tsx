import { tr } from "../../i18n/language";

export default function RecordSectionLinks({
  showAccount = false,
}: {
  showAccount?: boolean;
}) {
  return (
    <nav className="record-section-links" aria-label={tr("Record sections")}>
      <a href="#record-personal">{tr("Personal details")}</a>
      <a href="#record-service">{tr("Service records")}</a>
      {showAccount && <a href="#record-account">{tr("Account access")}</a>}
    </nav>
  );
}
