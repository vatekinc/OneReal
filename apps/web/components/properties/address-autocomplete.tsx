'use client';

import { useRef, useCallback } from 'react';
import { LoadScript, Autocomplete } from '@react-google-maps/api';
import { Input } from '@onereal/ui';

const libraries: ('places')[] = ['places'];

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
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const onLoad = useCallback((autocomplete: google.maps.places.Autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const onPlaceChanged = useCallback(() => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.address_components) return;

    const parsed = parsePlace(place);
    onAddressSelect(parsed);

    // Sync the input value with React state
    if (inputRef.current) {
      onChange(inputRef.current.value);
    }
  }, [onAddressSelect, onChange]);

  // No API key — plain input fallback
  if (!apiKey) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter address"
      />
    );
  }

  return (
    <LoadScript googleMapsApiKey={apiKey} libraries={libraries}>
      <Autocomplete
        onLoad={onLoad}
        onPlaceChanged={onPlaceChanged}
        options={{
          componentRestrictions: { country: 'us' },
          types: ['address'],
          fields: ['address_components', 'formatted_address'],
        }}
      >
        <input
          ref={inputRef}
          type="text"
          defaultValue={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        />
      </Autocomplete>
    </LoadScript>
  );
}
