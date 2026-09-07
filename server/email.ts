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
