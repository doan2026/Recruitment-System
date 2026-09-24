import type { BuilderContent, CandidateProfile } from "./person1Api";
export function contentFromProfile(profile: CandidateProfile): BuilderContent {
  const section = (
    title: string,
    items: Record<string, unknown>[],
    keys: string[],
  ) => ({
    title,
    text: items
      .map((item) =>
        keys
          .map((k) => item[k])
          .filter(Boolean)
          .join(" · "),
      )
      .join("\n\n"),
  });
  return {
    fullName: profile.fullName ?? "",
    headline: profile.headline ?? "",
    summary: profile.summary ?? "",
    contact: [
      profile.phone,
      profile.address,
      profile.githubUrl,
      profile.linkedinUrl,
      profile.portfolioUrl,
    ]
      .filter(Boolean)
      .join(" · "),
    sections: [
      section("Kinh nghiệm", profile.experiences, [
        "companyName",
        "position",
        "startDate",
        "endDate",
        "description",
      ]),
      section("Học vấn", profile.educations, [
        "school",
        "major",
        "degree",
        "startDate",
        "endDate",
        "description",
      ]),
      section("Kỹ năng", profile.skills, ["name", "level"]),
      section("Chứng chỉ", profile.certificates, [
        "name",
        "issuer",
        "issuedAt",
        "credentialUrl",
      ]),
      section("Dự án", profile.projects, [
        "name",
        "role",
        "description",
        "url",
      ]),
    ],
  };
}
export function validateBuilder(value: unknown): BuilderContent {
  const v = value as BuilderContent;
  if (
    !v ||
    typeof v !== "object" ||
    !["fullName", "headline", "summary", "contact"].every(
      (k) => typeof (v as unknown as Record<string, unknown>)[k] === "string",
    ) ||
    !Array.isArray(v.sections) ||
    v.sections.length > 10 ||
    v.sections.some(
      (s) => !s || typeof s.title !== "string" || typeof s.text !== "string",
    ) ||
    JSON.stringify(v).length > 40000
  )
    throw new Error("Nội dung CV không hợp lệ hoặc vượt giới hạn.");
  return v;
}
export async function renderCvPdf(
  content: BuilderContent,
  template: "classic" | "modern",
): Promise<Blob> {
  validateBuilder(content);
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  const accent = template === "modern" ? "#006e2e" : "#222222";
  // Build only plain text nodes: builder input cannot inject links, HTML, images, or PDF actions.
  const document = {
    pageSize: "A4",
    pageMargins: [44, 40, 44, 40],
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.25 },
    info: { title: content.fullName + " — CV", author: content.fullName },
    content: [
      {
        text: content.fullName,
        fontSize: 24,
        bold: true,
        color: accent,
        margin: [0, 0, 0, 8],
      },
      { text: content.headline, fontSize: 14, margin: [0, 0, 0, 8] },
      {
        text: content.contact,
        fontSize: 9,
        color: "#444444",
        margin: [0, 0, 0, 16],
      },
      { text: content.summary, margin: [0, 0, 0, 14] },
      ...content.sections
        .filter((s) => s.text.trim())
        .flatMap((s) => [
          {
            text: s.title,
            fontSize: 13,
            bold: true,
            color: accent,
            margin: [0, 10, 0, 6],
          },
          { text: s.text, margin: [0, 0, 0, 8] },
        ]),
    ],
  };
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(document).getBlob(resolve);
    } catch (e) {
      reject(e);
    }
  });
}
