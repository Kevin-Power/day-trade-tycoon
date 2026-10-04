import { z } from "zod";

export const COURSE_INQUIRY_CONTACT_TYPES = ["email", "phone"] as const;
export const COURSE_INQUIRY_DEVICES = ["phone", "tablet", "desktop"] as const;
export const COURSE_INQUIRY_SUPPORTS = ["standard", "large-text", "step-by-step"] as const;
export const COURSE_INQUIRY_STATUSES = ["new", "handled"] as const;
export const COURSE_INQUIRY_PAGE_SIZE = 20;

function hasControlText(value: string, multiline = false): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && !(multiline && [9, 10, 13].includes(code)));
  });
}
const singleLine = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !hasControlText(value), "請使用單行文字");

export const courseInquirySchema = z.object({
  requestId: z.string().uuid(),
  name: singleLine(40),
  contactType: z.enum(COURSE_INQUIRY_CONTACT_TYPES),
  contact: singleLine(254),
  device: z.enum(COURSE_INQUIRY_DEVICES),
  support: z.enum(COURSE_INQUIRY_SUPPORTS),
  question: z.string().trim().min(1).max(600)
    .refine(value => !hasControlText(value, true), "詢問內容含不支援的字元"),
  consent: z.literal(true),
  website: z.literal(""),
}).strict().superRefine((data, context) => {
  const valid = data.contactType === "email"
    ? z.string().email().safeParse(data.contact).success
    : /^\+?[0-9 ()-]+$/.test(data.contact) && /^\+?\d{7,15}$/.test(data.contact.replace(/[ ()-]/g, ""));
  if (!valid) context.addIssue({ code: "custom", path: ["contact"], message: "請填寫有效的電子郵件或電話" });
}).transform(data => ({
  ...data,
  requestId: data.requestId.toLowerCase(),
  contact: data.contactType === "email" ? data.contact.toLowerCase() : data.contact.replace(/[ ()-]/g, ""),
  question: data.question.replace(/\r\n/g, "\n"),
}));

export const courseInquiryListSchema = z.object({
  status: z.enum(["all", ...COURSE_INQUIRY_STATUSES]).default("all"),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

export const courseInquiryUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(COURSE_INQUIRY_STATUSES),
}).strict();

export type CourseInquiryInput = z.infer<typeof courseInquirySchema>;
export type CourseInquiryStatus = (typeof COURSE_INQUIRY_STATUSES)[number];
export type CourseInquiryListInput = z.infer<typeof courseInquiryListSchema>;
export type CourseInquiryUpdateInput = z.infer<typeof courseInquiryUpdateSchema>;
export type CourseInquiryItem = {
  id: string;
  name: string;
  contactType: CourseInquiryInput["contactType"];
  contact: string;
  device: CourseInquiryInput["device"];
  support: CourseInquiryInput["support"];
  question: string;
  status: CourseInquiryStatus;
  createdAt: string;
};
export type CourseInquiryPage = { ok: true; items: CourseInquiryItem[]; total: number; hasMore: boolean };
