import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
export async function sendLink(email: string, url: string) {
  if (!process.env.SES_FROM_EMAIL)
    throw new Error("SES_FROM_EMAIL is required");
  const client = new SESv2Client({
    region: process.env.SES_REGION || process.env.AWS_REGION || "us-east-2",
  });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: process.env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: "Your injury.bot access link" },
          Body: {
            Text: {
              Data: `Open your private injury.bot workspace. This link expires in 15 minutes and works once.\n\n${url}\n\nIf you did not request access, ignore this email.`,
            },
          },
        },
      },
    }),
  );
}

export async function sendProductionComplete(email: string, url: string) {
  return sendCompletion(email, url, false);
}
export async function sendLibraryComplete(email: string, url: string) {
  return sendCompletion(email, url, true);
}
async function sendCompletion(email: string, url: string, library: boolean) {
  if (process.env.NODE_ENV !== "production")
    throw new Error("Completion emails are disabled outside production");
  if (!process.env.SES_FROM_EMAIL)
    throw new Error("SES_FROM_EMAIL is required");
  await new SESv2Client({
    region: process.env.SES_REGION || process.env.AWS_REGION || "us-east-2",
  }).send(
    new SendEmailCommand({
      FromEmailAddress: process.env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: {
            Data: library
              ? "Your injury.bot library definition is ready for review"
              : "Your injury.bot files are ready for review",
          },
          Body: {
            Text: {
              Data: library
                ? `The Injury Creation Agent has prepared your generic medical definition and cited references. Sign in to review the result in your injury library. It remains private until approved for sharing.\n\n${url}\n\nThis link requires access to your authorized workspace.`
                : `Your injury production request is complete. The generated files are saved in your private case Evidence library. Sign in to review them and approve any atlas placement.\n\n${url}\n\nThis link does not grant access to anyone outside your authorized workspace.`,
            },
          },
        },
      },
    }),
    { abortSignal: AbortSignal.timeout(30000) },
  );
}
