'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

interface AddressComponents {
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelect: (components: AddressComponents) => void;
  placeholder?: string;
}

// Load Google Maps script exactly once
let scriptLoadPromise: Promise<void> | null = null;
function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  if (typeof window !== 'undefined' && window.google?.maps?.places) {
    return Promise.resolve();
  }

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error('Failed to load Google Maps'));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

function parsePlace(place: google.maps.places.PlaceResult): AddressComponents {
  const components = place.address_components ?? [];
  let streetNumber = '';
  let route = '';
  let city = '';
  let state = '';
  let zip = '';
  let country = '';

  for (const component of components) {
    const type = component.types[0];
    switch (type) {
      case 'street_number':
        streetNumber = component.long_name;
        break;
      case 'route':
        route = component.long_name;
        break;
      case 'locality':
      case 'sublocality_level_1':
        city = component.long_name;
        break;
      case 'administrative_area_level_1':
        state = component.short_name;
        break;
      case 'postal_code':
        zip = component.long_name;
        break;
      case 'country':
        country = component.short_name;
        break;
    }
  }

  return {
    address_line1: streetNumber ? `${streetNumber} ${route}` : route,
    city,
    state,
    zip,
    country: country || 'US',
  };
}

export function AddressAutocomplete({
  value,
  onChange,
  onAddressSelect,
  placeholder = 'Start typing an address...',
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [loaded, setLoaded] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const handlePlaceChanged = useCallback(() => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.address_components) return;

    const parsed = parsePlace(place);
    onAddressSelect(parsed);

    // Sync the displayed value back to React state
    if (inputRef.current) {
      onChange(inputRef.current.value);
    }
  }, [onAddressSelect, onChange]);

  useEffect(() => {
    if (!apiKey) return;

    loadGoogleMapsScript(apiKey)
      .then(() => setLoaded(true))
      .catch(() => {/* script failed to load, input still works as plain text */});
  }, [apiKey]);

  useEffect(() => {
    if (!loaded || !inputRef.current || autocompleteRef.current) return;

    const ac = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'us' },
      types: ['address'],
      fields: ['address_components', 'formatted_address'],
    });

    ac.addListener('place_changed', handlePlaceChanged);
    autocompleteRef.current = ac;
  }, [loaded, handlePlaceChanged]);

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={apiKey ? placeholder : 'Enter address'}
      autoComplete="off"
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
    />
  );
}
