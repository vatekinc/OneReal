'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useLoadScript } from '@react-google-maps/api';
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

export function AddressAutocomplete({
  value,
  onChange,
  onAddressSelect,
  placeholder = 'Start typing an address...',
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded } = useLoadScript({
    googleMapsApiKey: apiKey ?? '',
    libraries,
    preventGoogleFontsLoading: true,
  });

  const handlePlaceSelect = useCallback(() => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.address_components) return;

    const components = place.address_components;
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

    const addressLine1 = streetNumber ? `${streetNumber} ${route}` : route;

    onAddressSelect({
      address_line1: addressLine1,
      city,
      state,
      zip,
      country: country || 'US',
    });
  }, [onAddressSelect]);

  useEffect(() => {
    if (!isLoaded || !inputRef.current || !apiKey) return;
    if (autocompleteRef.current) return;

    autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'us' },
      types: ['address'],
      fields: ['address_components', 'formatted_address'],
    });

    autocompleteRef.current.addListener('place_changed', handlePlaceSelect);
  }, [isLoaded, apiKey, handlePlaceSelect]);

  // If no API key, render a basic input
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
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={isLoaded ? placeholder : 'Loading...'}
      autoComplete="off"
    />
  );
}
