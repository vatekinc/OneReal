export function downloadCsv(
  filename: string,
  headers: string[],
  rows: string[][]
): void {
  // Escape double quotes and wrap each cell in quotes
  const escapedHeaders = headers.map((header) =>
    `"${header.replace(/"/g, '""')}"`
  );
  const escapedRows = rows.map((row) =>
    row.map((cell) => `"${cell.replace(/"/g, '""')}"`)
  );

  // Build CSV string
  const csvContent = [
    escapedHeaders.join(','),
    ...escapedRows.map((row) => row.join(',')),
  ].join('\n');

  // Create Blob
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  // Create download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;

  // Trigger download
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
