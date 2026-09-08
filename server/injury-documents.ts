import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, Packer, Paragraph, HeadingLevel, ImageRun } from "docx";
import type { ProductionInput } from "./production";
const clean = (s: string) => s.replace(/[^\x20-\x7e\n]/g, "?");
export async function injuryDocuments(
  name: string,
  d: ProductionInput,
  metadata: string,
  aiDemand = "",
  images: Buffer[] = [],
  approved = false,
) {
  const sections = [
    ["Injury description", d.description],
    [
      "Medical background",
      d.medicalDescription || "No separate medical background supplied.",
    ],
    ["Medical references", d.medicalReferences || "Not supplied."],
    [
      "Case evidence",
      `${d.evidenceId || "No source linked"}\n${d.citation || "No citation supplied"}`,
    ],
    ["Client-specific effects", d.clientImpact || "Not documented."],
    ["Impact source", d.impactCitation || "Not supplied."],
    [
      "Illustration basis",
      d.measurementBasis || "Documentation only; no 3D illustration.",
    ],
    ["Production record", metadata],
  ];
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage(),
    y = 790;
  const line = (text: string, heading = false) => {
    const face = heading ? bold : font,
      size = heading ? 13 : 10;
    if (face.widthOfTextAtSize(clean(text), size) > 500) {
      let cut = text.length - 1;
      while (
        cut > 1 &&
        face.widthOfTextAtSize(clean(text.slice(0, cut)), size) > 500
      )
        cut--;
      const space = text.lastIndexOf(" ", cut);
      if (space > cut / 2) cut = space;
      line(text.slice(0, cut), heading);
      line(text.slice(cut).trimStart(), heading);
      return;
    }
    if (y < 55) {
      page = pdf.addPage();
      y = 790;
    }
    page.drawText(clean(text), {
      x: 45,
      y,
      size: heading ? 13 : 10,
      font: heading ? bold : font,
      color: rgb(0.12, 0.18, 0.17),
    });
    y -= heading ? 23 : 15;
  };
  line("injury.bot | Injury documentation", true);
  line(name, true);
  line(
    approved
      ? "ATTORNEY-APPROVED EXHIBIT VERSION"
      : "DRAFT FOR ATTORNEY REVIEW",
  );
  line("Reference anatomy illustration; not patient imaging.");
  y -= 12;
  for (const [title, text] of sections) {
    line(title, true);
    for (const paragraph of text.split("\n")) {
      const words = clean(paragraph).split(/\s+/);
      let current = "";
      for (const word of words) {
        if ((current + word).length > 88) {
          line(current);
          current = "";
        }
        current += word + " ";
      }
      line(current);
    }
    y -= 12;
  }
  for (const [i, bytes] of images.entries()) {
    const png = await pdf.embedPng(bytes);
    const imagePage = pdf.addPage();
    imagePage.drawImage(png, { x: 35, y: 180, width: 525, height: 394 });
    imagePage.drawText(clean(`Injury illustration | View ${i + 1}`), {
      x: 35,
      y: 750,
      size: 12,
      font: bold,
    });
    imagePage.drawText(
      approved
        ? "Attorney-approved illustration; reference anatomy"
        : "Draft illustration; reference anatomy",
      { x: 35, y: 720, size: 10, font },
    );
  }
  const demand = [
    ["Injury and evidence", d.description],
    [
      "Effects on the client",
      d.clientImpact || "Client effects require documentation.",
    ],
    ["Supporting sources", `${d.citation}\n${d.impactCitation}`],
    [
      "Proposed demand narrative",
      aiDemand ||
        "Prepare the demand argument from the reviewed injury, treatment, and client-impact evidence. No automated damages valuation has been made.",
    ],
    ["Medical context", d.medicalDescription],
    ["Medical references", d.medicalReferences],
    [
      "Version and illustration assumptions",
      metadata + "\n" + d.measurementBasis,
    ],
  ];
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: "injury.bot — Demand packet working draft",
            heading: HeadingLevel.TITLE,
          }),
          new Paragraph(name),
          new Paragraph(
            "Attorney review required. Statements below retain their supplied sources and do not establish causation or prognosis independently.",
          ),
          ...images.map(
            (data) =>
              new Paragraph({
                children: [
                  new ImageRun({
                    type: "png",
                    data,
                    transformation: { width: 540, height: 405 },
                  }),
                ],
              }),
          ),
          ...demand.flatMap(([title, text]) => [
            new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
            ...text.split("\n").map((text) => new Paragraph(text)),
          ]),
        ],
      },
    ],
  });
  return {
    pdf: Buffer.from(await pdf.save()),
    docx: await Packer.toBuffer(doc),
  };
}
