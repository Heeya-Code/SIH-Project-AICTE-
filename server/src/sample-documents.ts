import PDFDocument from 'pdfkit';
import type { DB } from './db';
import { DOC_NAMES, docName } from './docnames';

type SampleSection = { heading: string; lines: string[] };
type SampleProfile = { description: string; sections: SampleSection[] };

const PROFILES: Record<string, SampleProfile> = {
  'Land / Title Documents': {
    description: 'Illustrative property and site particulars for an institutional application.',
    sections: [
      { heading: 'Property particulars', lines: ['Plot reference: DEMO-PLOT-014', 'Location: Example Knowledge Park, Nandipur, Karnataka (fictional)', 'Area stated for this example: 8,000 square metres', 'Tenure evidence: example ownership record; no title search has been performed'] },
      { heading: 'Record checklist', lines: ['Site address and survey reference — example entry present', 'Boundary plan — see the sample Building Plan', 'Ownership / lease evidence — fictional placeholder only', 'Independent legal and land-use verification — not performed'] },
      { heading: 'Important note', lines: ['This sample does not establish ownership, possession, land use, or eligibility. Attach genuine, current records and obtain appropriate professional review.'] },
    ],
  },
  'Lease Deed': {
    description: 'Fictional lease summary with term, premises, and renewal fields.',
    sections: [
      { heading: 'Parties and premises', lines: ['Lessor: Example Property Cooperative (fictional)', 'Lessee: Aranya Institute of Applied Sciences (fictional)', 'Premises: Plot DEMO-PLOT-014, Nandipur, Karnataka', 'Purpose: Educational use as described in the illustrative schedule'] },
      { heading: 'Illustrative terms', lines: ['Commencement: 01 July 2026', 'Example term: 15 years, subject to executed instrument and applicable law', 'Renewal: Written agreement by the parties; no automatic renewal is represented here', 'Rent, registration, stamp duty, and covenants: refer to an executed legal instrument'] },
      { heading: 'Execution fields', lines: ['Lessor signature: [not signed]', 'Lessee authorised signatory: [not signed]', 'Witnesses / registration details: [not supplied]', 'This summary is not a lease deed and creates no rights or obligations.'] },
    ],
  },
  'Fire Safety Certificate': {
    description: 'Educational mock fire-safety record; not issued by an authority.',
    sections: [
      { heading: 'Illustrative inspection checklist', lines: ['Exit routes and signage — example item; not inspected', 'Alarm and detection systems — example item; not tested', 'Fire-fighting equipment — example item; not tested', 'Training and evacuation plan — example item; not reviewed'] },
      { heading: 'Mock record fields', lines: ['Inspection date: [sample date to be completed]', 'Issuing authority: [not issued]', 'Certificate number: DEMO-FIRE-0001 (fictional)', 'Validity: [not established]'] },
      { heading: 'Safety notice', lines: ['DEMO SAMPLE — FICTIONAL DATA — NOT AN OFFICIAL CERTIFICATE.', 'No building or fire-safety inspection has taken place. This example must never be used as evidence of safety or compliance.'] },
    ],
  },
  'Trust / Society Registration': {
    description: 'Fictional entity-registration particulars and evidence checklist.',
    sections: [
      { heading: 'Entity particulars', lines: ['Entity: Aranya Education Foundation (fictional)', 'Form: Example public charitable trust', 'Registration reference: DEMO-TRUST-0008', 'Registered office: 18 Learning Avenue, Nandipur, Karnataka (fictional)'] },
      { heading: 'Supporting record checklist', lines: ['Registration instrument / certificate — placeholder only', 'Governing document and amendments — not attached', 'Current office-bearer details — illustrative only', 'Independent verification with the registering authority — not performed'] },
      { heading: 'Declaration status', lines: ['No registration has been verified. This is a sample format, not a certificate or proof of legal status.'] },
    ],
  },
  'Annual Self-Disclosure': {
    description: 'Structured illustrative annual disclosure with evidence and review fields.',
    sections: [
      { heading: 'Disclosure period', lines: ['Institution: Aranya Institute of Applied Sciences (fictional)', 'Academic year: 2026–27 (illustrative)', 'Application reference: DEMO-AF-2026-00127', 'Prepared on: 27 October 2026 (example only)'] },
      { heading: 'Disclosure checklist', lines: ['Institution and programme particulars — example entry', 'Faculty and infrastructure information — see linked sample formats', 'Compliance evidence — attach current supporting records', 'Changes since prior disclosure — [describe and evidence]'] },
      { heading: 'Authorisation', lines: ['Prepared by: [name and designation]', 'Authorised signatory: [not signed]', 'Review status: Sample only; no review has taken place'] },
    ],
  },
  'Infrastructure Statement': {
    description: 'Illustrative facilities inventory with capacity and evidence fields.',
    sections: [
      { heading: 'Facilities inventory', lines: ['Teaching rooms: 12 (illustrative count)', 'Library: 1 facility; collection details [to be evidenced]', 'Laboratories: 4 rooms; equipment schedule [attach separately]', 'Accessible facilities: [describe and attach supporting evidence]'] },
      { heading: 'Evidence checklist', lines: ['Room-wise area statement — example only', 'Photographs / plans with date and location — not attached', 'Equipment register and maintenance record — not attached', 'Physical verification — not performed'] },
      { heading: 'Review notes', lines: ['All counts and descriptions are fictional sample values. They are not verified findings or a statement of applicable standards.'] },
    ],
  },
  'Faculty List': {
    description: 'Fictional staff roster example with qualification and appointment fields.',
    sections: [
      { heading: 'Example roster', lines: ['Name: Asha Nair (fictional) | Role: Professor | Department: Applied Computing', 'Name: Dev Malhotra (fictional) | Role: Associate Professor | Department: Design Systems', 'Name: Farah Qureshi (fictional) | Role: Assistant Professor | Department: Applied Computing'] },
      { heading: 'Record fields to maintain', lines: ['Qualification and awarding institution', 'Appointment date, employment status, and workload', 'Programme / department assignment', 'Supporting appointment and qualification records'] },
      { heading: 'Privacy and verification', lines: ['Names and entries above are invented. Do not treat this list as staff evidence; protect genuine personnel data and verify it through authorised processes.'] },
    ],
  },
  'Building Plan': {
    description: 'Illustrative drawing register and building-plan review checklist.',
    sections: [
      { heading: 'Drawing register', lines: ['Site plan: DEMO-PLAN-S01 | Revision 0 | Example only', 'Floor plan: DEMO-PLAN-A01 | Revision 0 | Not to scale', 'Accessibility plan: DEMO-PLAN-AC01 | Placeholder', 'Prepared by: [registered professional details not supplied]'] },
      { heading: 'Review checklist', lines: ['Drawing title, date, revision, and scale — to be confirmed', 'Room labels and use — illustrative only', 'Access, egress, and safety details — professional review required', 'Authority approval / sanction reference — not supplied'] },
      { heading: 'Disclaimer', lines: ['This text-only register is not a building plan, sanctioned drawing, or safety assessment.'] },
    ],
  },
  'Closure Declaration': {
    description: 'Illustrative closure declaration with institution and authorisation fields.',
    sections: [
      { heading: 'Declaration details', lines: ['Institution: Aranya Institute of Applied Sciences (fictional)', 'Application reference: DEMO-AF-2026-00127', 'Declared activity / closure scope: [complete with the actual facts]', 'Effective date: [to be supplied by the institution]'] },
      { heading: 'Supporting checklist', lines: ['Competent governing-body resolution — not attached', 'Student and staff transition arrangements — not supplied', 'Asset / record custody plan — not supplied', 'Required notifications and acknowledgements — not established'] },
      { heading: 'Authorisation', lines: ['Authorised signatory: [not signed]', 'Date: [not supplied]', 'This blank-for-completion example is not a declaration or approval.'] },
    ],
  },
  Other: {
    description: 'General supporting-document cover sheet with provenance and review fields.',
    sections: [
      { heading: 'Evidence description', lines: ['Document purpose: [describe the evidence]', 'Related requirement or application stage: [identify precisely]', 'Issuing / preparing organisation: [provide source]', 'Issue date and validity: [provide if applicable]'] },
      { heading: 'Provenance and review', lines: ['Source file and version: [record the submitted file]', 'Authenticity check: [not performed]', 'Reviewer observations: [record separately]', 'Status: Illustrative sample only'] },
      { heading: 'Note', lines: ['Use this cover sheet to describe genuine supporting evidence; it does not replace the evidence itself.'] },
    ],
  },
  'Institutional Undertaking': {
    description: 'Illustrative institutional declaration with commitments and signatory fields.',
    sections: [
      { heading: 'Undertaking particulars', lines: ['Institution: Aranya Institute of Applied Sciences (fictional)', 'Application: DEMO-AF-2026-00127', 'Period: 2026–27 (illustrative)', 'Authorised signatory: [name and designation]'] },
      { heading: 'Example commitments', lines: ['Maintain accurate institutional and programme records.', 'Submit requested supporting evidence through the authorised workflow.', 'Notify the relevant authority of material changes where required.', 'Retain records for review and cooperate with authorised verification.'] },
      { heading: 'Execution', lines: ['Date: [to be completed]', 'Signature: [not signed]', 'These example statements are not an AICTE-prescribed undertaking and create no legal commitment.'] },
    ],
  },
  'Compliance Report': {
    description: 'Illustrative checklist linking a requirement, evidence, status, and corrective action.',
    sections: [
      { heading: 'Example review table', lines: ['Requirement: Current land / lease record | Evidence: DEMO-LEASE-0001 | Status: Pending review', 'Requirement: Faculty particulars | Evidence: DEMO-FACULTY-0001 | Status: Sample available', 'Requirement: Safety record | Evidence: DEMO-FIRE-0001 | Status: Not verified', 'Observation: Evidence and applicability must be checked by an authorised reviewer.'] },
      { heading: 'Review metadata', lines: ['Institution: Aranya Institute of Applied Sciences (fictional)', 'Submitted / reviewed date: [not recorded]', 'Reviewer: [not assigned]', 'Corrective action and due date: [only when recorded in the system]'] },
      { heading: 'Status note', lines: ['This is a fictional example, not a compliance determination or official checklist.'] },
    ],
  },
  'Inspection Report': {
    description: 'Fictional EVC / site-visit report format; no inspection has taken place.',
    sections: [
      { heading: 'Visit particulars', lines: ['Reference: DEMO-EVC-0001', 'Institution: Aranya Institute of Applied Sciences (fictional)', 'Visit date and location: [not conducted]', 'Team: [authorised roles to be recorded; no real persons named]'] },
      { heading: 'Illustrative areas to record', lines: ['Campus and facilities — sample checklist item', 'Laboratories and equipment — sample checklist item', 'Faculty records — sample checklist item', 'Safety and accessibility — sample checklist item'] },
      { heading: 'Findings and outcome', lines: ['Observations: [no visit findings exist]', 'Deficiencies / corrective actions: [not assessed]', 'Recommendation: [no recommendation made]', 'This is not an inspection, an EVC report, or a recommendation about an institution.'] },
    ],
  },
  'Deficiency Notice': {
    description: 'Illustrative clarification notice with an example-only response deadline.',
    sections: [
      { heading: 'Notice particulars', lines: ['Application: DEMO-AF-2026-00127', 'Notice reference: DEMO-DEF-0001', 'Date: 27 October 2026 (illustrative)', 'Status: Sample only; no real notice has been issued'] },
      { heading: 'Example deficiency', lines: ['The uploaded supporting record does not show the required validity details in this fictional case.', 'Requested response: Provide a clear, current supporting record and identify its issue and expiry dates.', 'Illustrative response date: 10 November 2026 — not a statutory or configured deadline.'] },
      { heading: 'Response instructions', lines: ['Use the case workflow to upload a corrected version and submit a clarification.', 'The reviewing officer must assess the resubmission; upload alone does not verify a document.'] },
    ],
  },
  'Clarification Response': {
    description: 'Illustrative institutional response linked to a deficiency and resubmission.',
    sections: [
      { heading: 'Response particulars', lines: ['Application: DEMO-AF-2026-00127', 'Related notice: DEMO-DEF-0001', 'Response version: 2 (illustrative)', 'Submitted by: [institution representative] | Date: [not recorded]'] },
      { heading: 'Response and evidence', lines: ['Response: The institution explains the correction and where it appears in the submitted record.', 'Evidence: DEMO-DOC-0002 (fictional sample file)', 'Changes from prior submission: [describe the changed fields]', 'Officer review: Pending; this example is not verified.'] },
      { heading: 'Workflow note', lines: ['A response does not itself close a deficiency. An authorised reviewer records the outcome.'] },
    ],
  },
  'Decision Communication': {
    description: 'Fictional approval / rejection communication example with no real decision.',
    sections: [
      { heading: 'Communication particulars', lines: ['Application: DEMO-AF-2026-00127', 'Reference: DEMO-DEC-0001', 'Decision date: [not recorded]', 'Authority: [not identified]'] },
      { heading: 'Decision field', lines: ['Outcome: NOT ISSUED — no approval or rejection has been made in this example.', 'Reasons and conditions: [must reflect an actual recorded decision]', 'Effective date / next steps: [not applicable]'] },
      { heading: 'Prominent notice', lines: ['This is a fictional communication format. It is not an approval, rejection, permission, or government order.'] },
    ],
  },
  'Document Renewal Record': {
    description: 'Illustrative renewal and version-history record; no validity is established.',
    sections: [
      { heading: 'Renewal history', lines: ['Document type: Lease Agreement (fictional)', 'Prior version: v1 | expiry recorded: 31 March 2027 (example)', 'Submitted renewal: v2 | received: [not recorded]', 'Verification: Pending unless the real system record says otherwise'] },
      { heading: 'Review checklist', lines: ['Confirm the new issue and expiry dates from the document itself.', 'Retain the previous version and link the renewal to its lineage.', 'An upload is evidence submitted for review, not proof of renewal or verification.'] },
      { heading: 'Status', lines: ['This example is not a renewed lease, legal instrument, or verified validity record.'] },
    ],
  },
};

const WORKFLOW_EXAMPLES = new Set([
  'Institutional Undertaking', 'Compliance Report', 'Inspection Report', 'Deficiency Notice',
  'Clarification Response', 'Decision Communication', 'Document Renewal Record',
]);

const SAMPLE_ALIASES: Record<string, string[]> = {
  'Land / Title Documents': ['land', 'title', 'ownership'],
  'Lease Deed': ['lease', 'rent'],
  'Fire Safety Certificate': ['fire', 'safety'],
  'Trust / Society Registration': ['trust', 'society', 'registration'],
  'Annual Self-Disclosure': ['annual', 'self disclosure'],
  'Infrastructure Statement': ['infrastructure', 'laboratory', 'lab'],
  'Faculty List': ['faculty', 'staff'],
  'Building Plan': ['building plan', 'architect'],
  'Closure Declaration': ['closure'],
  Other: ['supporting evidence', 'supporting document', 'sample document'],
  'Institutional Undertaking': ['institutional undertaking', 'undertaking'],
  'Compliance Report': ['compliance report', 'compliance checklist'],
  'Inspection Report': ['inspection', 'site visit', 'evc report'],
  'Deficiency Notice': ['deficiency', 'deficiencies', 'notice'],
  'Clarification Response': ['clarification', 'resubmission', 'response'],
  'Decision Communication': ['decision communication', 'approval letter', 'rejection letter'],
  'Document Renewal Record': ['renewal', 'renewed document'],
};

const profileFor = (type: string): SampleProfile => PROFILES[type] ?? {
  description: `Fictional example fields for ${docName(type)}.`,
  sections: [
    { heading: 'Illustrative particulars', lines: ['Institution: Aranya Institute of Applied Sciences (fictional)', 'Reference: DEMO-DOC-0001', 'Purpose: Example format only', 'Issue / validity details: [to be completed from a genuine record]'] },
    { heading: 'Evidence and review', lines: ['Supporting evidence: [not attached]', 'Authenticity review: [not performed]', 'Review status: Sample only'] },
  ],
};

export function documentSampleCatalog(db: DB) {
  const found = new Set([
    ...Object.keys(DOC_NAMES),
    ...WORKFLOW_EXAMPLES,
    ...(db.prepare('SELECT DISTINCT doc_type FROM document_requirements').all() as { doc_type: string }[]).map(x => x.doc_type),
  ]);
  return [...found].sort((a, b) => docName(a).localeCompare(docName(b))).map(doc_type => ({
    doc_type,
    display_name: docName(doc_type),
    description: profileFor(doc_type).description,
    file_name: `demo-sample-${doc_type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    kind: WORKFLOW_EXAMPLES.has(doc_type) ? 'workflow_example' : 'document_category',
    status: 'Sample available',
    notice: 'Fictional example only; not an official certificate, verified evidence, or approval.',
  }));
}

export function matchingSampleDocuments(db: DB, question: string) {
  const normalized = question.toLowerCase();
  if (!/\b(sample|example|format|template|show me|what information|what info|document|certificate|evidence|report|notice)\b/.test(normalized)) return [];
  return documentSampleCatalog(db)
    .filter(doc => (SAMPLE_ALIASES[doc.doc_type] ?? [doc.display_name.toLowerCase()]).some(term => normalized.includes(term)))
    .map(doc => ({
      doc_type: doc.doc_type,
      display_name: doc.display_name,
      link: `/documents?sample=${encodeURIComponent(doc.doc_type)}`,
      kind: doc.kind,
    }));
}

export function sampleKnowledge(samples: { doc_type: string; display_name: string }[]) {
  return samples.map(sample => ({
    title: sample.display_name,
    statement: profileFor(sample.doc_type).sections
      .map(section => `${section.heading}: ${section.lines.join(' ')}`)
      .join('\n'),
    status: 'illustrative_sample_not_official',
    source: 'ApprovalFlow generated fictional sample',
    section: null,
    page: null,
  }));
}

export async function renderSamplePdf(docType: string, metadata: Record<string, string | number | null | undefined> = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 52, bufferPages: true });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const profile = profileFor(docType);
  const label = docName(docType);
  const ink = '#13264B', blue = '#2F5BEA', muted = '#536278';

  doc.rect(0, 0, doc.page.width, 12).fill(blue);
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(9).fillColor('#A12626')
    .text('DEMO SAMPLE — FICTIONAL DATA — NOT AN OFFICIAL DOCUMENT', { align: 'center' });
  doc.moveDown(1).font('Helvetica-Bold').fontSize(21).fillColor(ink).text(label, { align: 'left' });
  doc.moveDown(0.25).font('Helvetica').fontSize(10).fillColor(muted).text(profile.description);
  doc.moveDown(0.8);

  const info: [string, string][] = [
    ['Sample reference', String(metadata.reference_no ?? `DEMO-${docType.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24)}-0001`)],
    ['Institution', String(metadata.institution_name ?? 'Aranya Institute of Applied Sciences (fictional)')],
    ['Application', String(metadata.application_ref ?? 'Illustrative sample; not linked to an application')],
    ['Document status', String(metadata.verification_status ? `Recorded in demo as ${metadata.verification_status}` : 'Sample available; not submitted or verified')],
    ['Issue date', String(metadata.issue_date ?? 'Illustrative / not established')],
    ['Validity / expiry', String(metadata.expiry_date ?? 'Not established for this example')],
  ];
  doc.roundedRect(52, doc.y, doc.page.width - 104, 120, 7).fill('#F1F5FC');
  const startY = doc.y + 12;
  info.forEach(([key, value], i) => {
    const y = startY + i * 16;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(muted).text(key.toUpperCase(), 64, y, { width: 118 });
    doc.font('Helvetica').fontSize(9).fillColor(ink).text(value, 184, y, { width: doc.page.width - 248 });
  });
  doc.y = startY + 126;

  for (const section of profile.sections) {
    if (doc.y > doc.page.height - 135) doc.addPage();
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor(blue).text(section.heading);
    doc.moveDown(0.25);
    for (const line of section.lines) {
      const isBullet = line.length > 0;
      doc.font('Helvetica').fontSize(9.5).fillColor(ink).text(`${isBullet ? '•  ' : ''}${line}`, { indent: 5, paragraphGap: 4, lineGap: 2 });
    }
  }
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(9).fillColor('#A12626')
    .text('This sample is fictional. It is not issued, signed, stamped, verified, or approved by AICTE or any authority.', { align: 'left' });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.rect(0, 0, doc.page.width, 5).fill(blue);
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#A12626')
      .text('DEMO SAMPLE · FICTIONAL DATA · NOT OFFICIAL', 52, 22, { lineBreak: false });
    const y = doc.page.height - 38;
    doc.moveTo(52, y - 8).lineTo(doc.page.width - 52, y - 8).strokeColor('#DCE3EF').stroke();
    doc.font('Helvetica').fontSize(8).fillColor(muted)
      .text('ApprovalFlow demonstration prototype · Synthetic example only', 52, y, { width: 370, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, doc.page.width - 135, y, { width: 83, align: 'right', lineBreak: false });
  }
  doc.end();
  return result;
}
