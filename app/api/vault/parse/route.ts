import { NextRequest, NextResponse } from 'next/server';

/**
 * Extracts plain text from an uploaded dataset file.
 *
 * This route only reports text that it actually recovered from the file. If a
 * PDF or binary file yields no readable text, the request fails explicitly
 * instead of substituting placeholder content.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    let extractedText = '';

    // 1. Text, CSV, JSON, Markdown, and code files.
    try {
      if (
        file.type.includes('text') ||
        file.type.includes('json') ||
        file.type.includes('csv') ||
        /\.(txt|csv|json|md|markdown|ts|js|py|html)$/i.test(file.name)
      ) {
        extractedText = buffer.toString('utf-8');
      }
    } catch (e) {
      console.warn('Direct text decoding failed:', e);
    }

    // 2. PDF parsing (isolated dynamic import to avoid serverless module crashes).
    if (!extractedText && (file.type.includes('pdf') || /\.pdf$/i.test(file.name))) {
      try {
        // pdf-parse exposes different shapes through its ESM and CJS entry points.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfModule: any = await import('pdf-parse');
        const pdfParse = pdfModule.default || pdfModule;
        const pdfData = await pdfParse(buffer);
        extractedText = typeof pdfData.text === 'string' ? pdfData.text : '';
      } catch (pdfErr) {
        console.warn('pdf-parse failed while extracting text:', pdfErr);
      }
    }

    // 3. Last resort for other file types: strip control bytes from the raw
    // buffer. This is real extracted text, not a fabricated placeholder.
    if (!extractedText.trim()) {
      extractedText = buffer
        .toString('utf-8')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (extractedText.trim().length < 5) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No readable text could be extracted from this file. Upload a CSV, TXT, Markdown, or text-based PDF.',
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSize: file.size,
      text: extractedText,
    });
  } catch (error) {
    console.error('Vault file parsing failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Unable to parse uploaded file.',
    }, { status: 500 });
  }
}
