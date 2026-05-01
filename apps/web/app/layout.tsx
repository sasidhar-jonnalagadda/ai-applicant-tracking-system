export const metadata = {
  title: 'AI Applicant Tracking System',
  description: 'Production-grade AI ATS powered by Gemini and MongoDB',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}