export const metadata = {
  title: 'LeadStream',
  description: 'Nationwide garage door lead monitor',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#0d1117',
          color: '#e6edf3',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
