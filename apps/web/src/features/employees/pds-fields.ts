export type Field = {
  key: string;
  label: string;
  type?: "date" | "number" | "textarea" | "url" | "department";
  required?: boolean;
  wide?: boolean;
};
export type Section = {
  slug: string;
  responseKey: string;
  title: string;
  description: string;
  fields: Field[];
};

export const sections: Section[] = [
  {
    slug: "qualifications",
    responseKey: "academicQualifications",
    title: "Academic qualifications",
    description: "Degrees, institutions and academic results.",
    fields: [
      { key: "institution", label: "Institution", required: true },
      { key: "degree", label: "Degree / qualification", required: true },
      { key: "subject", label: "Subject" },
      { key: "passingYear", label: "Passing year", type: "number" },
      { key: "result", label: "Result / grade" },
    ],
  },
  {
    slug: "training",
    responseKey: "trainingRecords",
    title: "Training",
    description: "Local and foreign training records.",
    fields: [
      { key: "title", label: "Training title", required: true },
      { key: "provider", label: "Provider" },
      { key: "location", label: "Location" },
      { key: "startDate", label: "Start date", type: "date" },
      { key: "endDate", label: "End date", type: "date" },
      { key: "remarks", label: "Remarks", type: "textarea", wide: true },
    ],
  },
  {
    slug: "service-history",
    responseKey: "serviceHistory",
    title: "Service history",
    description: "Previous service and promotion history.",
    fields: [
      { key: "organization", label: "Organization", required: true },
      { key: "designation", label: "Designation", required: true },
      { key: "startDate", label: "Start date", type: "date" },
      { key: "endDate", label: "End date", type: "date" },
      {
        key: "description",
        label: "Description",
        type: "textarea",
        wide: true,
      },
    ],
  },
  {
    slug: "posting-history",
    responseKey: "postingHistory",
    title: "Posting history",
    description:
      "Historical office postings; this does not change the current department.",
    fields: [
      { key: "departmentId", label: "Department", type: "department" },
      { key: "officeName", label: "Office name" },
      { key: "designation", label: "Designation" },
      { key: "startDate", label: "Start date", type: "date" },
      { key: "endDate", label: "End date", type: "date" },
      { key: "orderReference", label: "Order reference" },
    ],
  },
  {
    slug: "memberships",
    responseKey: "professionalMemberships",
    title: "Professional memberships",
    description: "Professional society and association memberships.",
    fields: [
      { key: "organization", label: "Organization", required: true },
      { key: "membershipNumber", label: "Membership number" },
      { key: "membershipType", label: "Membership type" },
      { key: "startDate", label: "Start date", type: "date" },
      { key: "endDate", label: "End date", type: "date" },
    ],
  },
  {
    slug: "publications",
    responseKey: "publications",
    title: "Publications",
    description: "Published articles, papers and other works.",
    fields: [
      { key: "title", label: "Publication title", required: true },
      { key: "publicationName", label: "Journal / publication" },
      { key: "publicationDate", label: "Publication date", type: "date" },
      { key: "referenceUrl", label: "Reference URL", type: "url", wide: true },
    ],
  },
];
