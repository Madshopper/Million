# MadShopper

Dansk prissammenligning af dagligvarer for travle familier. Roligt, klart og hurtigt at skanne: prisen er det vigtigste på skærmen, og grøn betyder "gør noget" eller "billigst".

Denne fil beskriver det design, der allerede bruges på madshopper.dk (`static/css/styles.css`) og i appen (`apps/mobile/src/theme/colors.ts`), plus de forslag der står markeret **Forslag**. Forslagene er ikke indført i koden endnu.

## Overview

- Neutral grå baggrund, hvide kort, én grøn accent.
- Ingen glas-blur, ingen glød, ingen meget runde hjørner, ingen tonede baggrunde.
- Web og app bruger de samme farver og den samme skrift. Kun placering af menuer er forskellig (topheader på web, bundmenu i appen).

## Colors

Tre grønne, og kun dem (Kalle 03-10-2026). Gennemsigtige varianter bygges på `rgba(5, 150, 105, x)`.

- **Primær grøn** (#059669): plus-knap, ikoner, butiksmærker, valgte faner
- **Sekundær grøn** (#047857): grøn tekst, "Billigst"-mærket, hover. **Forslag:** også fladen på knapper med tekst (se Knapper)
- **Tertiær grøn** (#D6F5E3): lyse grønne flader, valgt filter
- **Tilbud** (#DFA300): flade med mørk tekst (#1A1C19). Tilbud er aldrig grønne eller røde
- **Tilbud, tekst på lys baggrund** (#A16207): **Forslag**, se nedenfor
- **Advarsel** (#D97706 / #FEF3C7): "næppe et rigtigt tilbud"
- **Fejl og slet** (#DC2626 web, #C62828 app): kun fejl og "fjern"
- **Baggrund** (#F9FAFB), **Flade** (#FFFFFF), **Tekst** (#111827), **Dæmpet tekst** (#6B7280), **Kant** (#E5E7EB)

### Mørk tilstand

- **Baggrund** (#111827), **Flade** (#1F2937), **Tekst** (#F9FAFB), **Dæmpet tekst** (#9CA3AF), **Kant** (#374151)
- Sekundær og tertiær grøn bytter plads: lys grøn tekst (#D6F5E3) på mørk grøn flade (#047857)

### Forslag til farver

1. **Samme grå i web og app.** I dag har appen en let grøn-tonet grå (#F7F8F5, #E2E6DE, mørk #121412), mens webben er neutral (#F9FAFB, #E5E7EB, mørk #111827). Forslag: appen bruger webbens neutrale grå, så de to ser ens ud side om side.
2. **Tilbudspris som tekst.** #DFA300 på hvid har kontrast 2,2:1 og er svær at læse i dagslys i butikken. Forslag: på lys baggrund skrives tilbudsprisen i #A16207 (4,9:1). #DFA300 bevares som flade (mærket) og som tekst i mørk tilstand, hvor den har 7,6:1.
3. **Knaptekst.** Hvid tekst på #059669 har 3,8:1, under kravet på 4,5:1 for almindelig tekst. Forslag: knapper med tekst får fladen #047857 (5,5:1). Runde ikonknapper (plus) beholder #059669. Ingen nye grønne nuancer.

## Typography

- **Font**: Plus Jakarta Sans (selvhostet i `static/fonts/`), fallback Inter, system-ui
- **Sideoverskrift**: 24px bold, linjehøjde 1.2
- **Sektion**: 18px bold, linjehøjde 1.3
- **Varenavn**: 15px semibold, linjehøjde 1.35, højst 2 linjer
- **Brødtekst**: 15px regular, linjehøjde 1.5
- **Pris**: 18px extra-bold, `tabular-nums` (**Forslag:** tal-bredder ens, så priser står lige under hinanden i sammenligningen)
- **Kilopris og enhed**: 13px regular, dæmpet tekst, lige under prisen
- **Mærkat**: 12px bold, versaler med 0.03em spatiering ("TILBUD", "BILLIGST")

Overskrifterne holdes mellemstore. Ingen ekstra store hero-overskrifter.

## Spacing

Grundenhed 4px. Skala: 4 / 8 / 12 / 16 / 24 / 32 / 48.

- Kort indvendigt: 12px (mobil), 16px (desktop)
- Mellem kort: 12px
- Mellem sektioner: 32px (mobil), 48px (desktop)

## Border Radius

- **sm** (8px): knapper, input, mærkater
- **md** (12px): varekort
- **lg** (16px): dialoger, bundark, kurven
- **fuld** (999px): kun runde ikonknapper og antal-vælger

**Forslag:** stop ved 16px. `--radius-xl` (24px) bruges i dag 38 steder og trækker mod det "AI-agtige" look, Kalle har sagt fra over.

## Elevation

Klassiske, neutrale skygger. Aldrig farvede skygger.

- **sm**: 0 1px 3px #000 8%, 0 1px 2px #000 4% (kort)
- **md**: 0 4px 12px #000 10%, 0 2px 4px #000 6% (rullemenuer)
- **lg**: 0 10px 30px #000 12%, 0 4px 8px #000 6% (dialoger)

## Components

### Buttons

- **Primær**: #047857 flade, hvid tekst, 8px hjørner, 600 vægt, 44px høj. Hover: 90% lysstyrke (ingen ny farve). **Forslag**: i dag #059669
- **Sekundær**: hvid flade, #047857 tekst, 1.5px #047857 kant
- **Stille**: ingen flade, #047857 tekst, hover #D6F5E3
- **Slet**: hvid flade, rød tekst og kant. Fuld rød flade kun bag en swipet vare
- **Læg i kurv (rund)**: #059669, 38px cirkel, hvidt plus-ikon
- **Størrelser**: lille 32px, normal 44px (mindste tryk-flade på mobil)
- **Deaktiveret**: 40% gennemsigtighed

**Forslag til plus-knappen:** fjern den grønne skygge (`0 3px 8px rgba(5,150,105,.25)`) og forstørrelsen ved hover (`scale(1.08)`). Begge minder om den grønne glød, der blev rullet tilbage i juli 2026. Brug i stedet en mørkere grøn ved hover.

### Cards (varekort)

Hvid flade, 1px #E5E7EB kant, 12px hjørner, sm-skygge. Billede øverst på hvid baggrund. Rækkefølge: butiksmærke, varenavn, mængde, pris, kilopris, plus-knap nederst til højre. Hover: kun kanten bliver mørkere, ingen glød.

### Mærkater

- **Billigst**: #047857 flade, hvid tekst
- **Tilbud**: #DFA300 flade, mørk tekst
- **Næppe tilbud**: #FEF3C7 flade, #D97706 tekst
- **Butiksmærke**: butikkens egen farve, hvid tekst

### Inputs

Hvid flade, 1.5px #D1D5DB kant, 8px hjørner, 44px høj. Fokus: kant #059669 og en 3px ring i rgba(5,150,105,.2).

## Do's and Don'ts

1. **Do** gør prisen til det tydeligste på hvert kort.
2. **Do** vis kilopris under prisen, så forskellige pakkestørrelser kan sammenlignes.
3. **Do** brug de samme farveværdier i web og app (`styles.css` og `colors.ts` skal følges ad).
4. **Don't** tilføj nye grønne nuancer.
5. **Don't** farv tilbud grønne eller røde.
6. **Don't** brug glas-blur, glød, tonede baggrunde eller hjørner over 16px.
7. **Don't** brug store hero-overskrifter.
