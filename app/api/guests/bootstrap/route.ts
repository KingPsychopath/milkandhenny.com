import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { parseCSV } from '@/lib/guests/csv-parser';
import { getGuests, setGuests } from '@/lib/guests/kv-client';
import { requireAuth } from '@/lib/auth';

/**
 * Bootstrap endpoint - loads guests from public/guests.csv if no guests exist
 * Uses HTTP fetch (works on Vercel) instead of filesystem read
 */
export async function POST(request: NextRequest) {
  const authError = requireAuth(request, "management");
  if (authError) return authError;

  try {
    // Check if guests already exist
    const existingGuests = await getGuests();
    if (existingGuests.length > 0) {
      return NextResponse.json({ 
        bootstrapped: false, 
        message: 'Guests already exist',
        count: existingGuests.length 
      });
    }

    // Get the base URL from the request headers
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = headersList.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;
    
    try {
      // Fetch CSV from public URL (works on Vercel serverless)
      const csvResponse = await fetch(`${baseUrl}/guests.csv`);
      if (!csvResponse.ok) {
        return NextResponse.json({ 
          bootstrapped: false, 
          message: 'No guests.csv found in public folder',
          count: 0 
        });
      }
      
      const csvContent = await csvResponse.text();
      const guests = parseCSV(csvContent);
      await setGuests(guests);
      
      return NextResponse.json({ 
        bootstrapped: true, 
        message: 'Loaded guests from CSV',
        count: guests.length 
      });
    } catch (fetchError) {
      console.error('CSV fetch error:', fetchError);
      return NextResponse.json({ 
        bootstrapped: false, 
        message: 'Failed to fetch guests.csv',
        error: String(fetchError),
        count: 0 
      });
    }
  } catch (error) {
    console.error('Bootstrap error:', error);
    return NextResponse.json({ error: 'Bootstrap failed', details: String(error) }, { status: 500 });
  }
}

/**
 * Force re-bootstrap - clears existing data and reloads from CSV.
 * Requires management password.
 */
export async function DELETE(request: NextRequest) {
  const deleteAuthError = requireAuth(request, "management");
  if (deleteAuthError) return deleteAuthError;

  try {
    // Clear existing guests
    await setGuests([]);
    
    // Re-run bootstrap
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = headersList.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;
    
    const csvResponse = await fetch(`${baseUrl}/guests.csv`);
    if (!csvResponse.ok) {
      return NextResponse.json({ 
        reset: true,
        bootstrapped: false, 
        message: 'Cleared data but no guests.csv found',
        count: 0 
      });
    }
    
    const csvContent = await csvResponse.text();
    const guests = parseCSV(csvContent);
    await setGuests(guests);
    
    return NextResponse.json({ 
      reset: true,
      bootstrapped: true, 
      message: 'Cleared and reloaded from CSV',
      count: guests.length 
    });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Reset failed', details: String(error) }, { status: 500 });
  }
}
