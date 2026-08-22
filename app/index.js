import React from 'react';
import { useInstanceStore } from '../stores/instanceStore';

import DomainEntryScreen from '../src/screens/DomainEntryScreen';
import WebViewScreen from '../src/screens/WebViewScreen';

/**
 * Startroute: die Instanz-WebView, bzw. die Domain-Eingabe, solange noch keine
 * Instanz hinterlegt ist. Inhaltlich unverändert gegenüber dem alten App.js —
 * nur beziehen die Screens ihren Zustand jetzt aus dem Store statt aus Props
 * eines Wurzel-Components.
 */
export default function Index()
{
  const list = useInstanceStore((s) => s.list);
  const active = useInstanceStore((s) => s.active);
  const add = useInstanceStore((s) => s.add);
  const select = useInstanceStore((s) => s.select);
  const remove = useInstanceStore((s) => s.remove);

  if (!active) return <DomainEntryScreen onDomainSaved={add} />;

  return (
    <WebViewScreen
      url={active}
      domains={list}
      onSelectDomain={select}
      onAddDomain={add}
      onRemoveDomain={remove}
    />
  );
}
