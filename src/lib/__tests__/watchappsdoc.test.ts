import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { docUrl, galleryImages, parseInline, parseWatchAppsDoc } from '../watchAppsDoc'

describe('page « Applications Garmin » modifiable sur GitHub', () => {
  it('fichier du dépôt : introduction, deux applications, champs, image et liste', () => {
    const doc = parseWatchAppsDoc(readFileSync('public/montre/applications.md', 'utf8'))
    expect(doc.intro.length).toBeGreaterThan(0)
    expect(doc.apps.map((a) => a.name)).toEqual(['Trail Planner', 'EndurancePro'])
    const tp = doc.apps[0]
    expect(tp).toMatchObject({ type: 'Champ de données', store: null, image: 'ecran-trail-planner.png' })
    expect(tp.body.some((b) => b.kind === 'list' && b.items.length === 5)).toBe(true)
    // L'en-tête d'aide (commentaire) ne s'affiche pas.
    expect(JSON.stringify(doc)).not.toContain('Commit changes')
    // L'image citée existe dans le dossier.
    expect(() => readFileSync(`public/montre/${tp.image}`)).not.toThrow()
    // Galerie des captures en course : cinq images, toutes présentes dans le dossier.
    const gallery = tp.body.map(galleryImages).find(Boolean)!
    expect(gallery.map((g) => g.alt)).toEqual(['Avant le départ', 'Sur le parcours', 'Entrée de ravito', 'Passage validé', 'Au ravito', 'Alerte nourriture'])
    for (const g of gallery) expect(() => readFileSync(`public/montre/${g.src}`)).not.toThrow()
    // Texte mêlé d'une image : pas une galerie.
    expect(galleryImages({ kind: 'p', parts: parseInline('un ![écran](a.png)') })).toBeNull()
    expect(galleryImages({ kind: 'list', items: [] })).toBeNull()
  })

  it('lien du Store, image et guide ; texte libre après les champs', () => {
    const doc = parseWatchAppsDoc(`Intro **courte**.

## EndurancePro
Type : Champ de données
Store : https://apps.garmin.com/apps/abc
Image : ep.png

Store : cette ligne fait partie du texte.

- un ![écran](ep2.png)
- [guide](https://example.org/guide)
`)
    const ep = doc.apps[0]
    expect(ep.store).toBe('https://apps.garmin.com/apps/abc')
    expect(ep.image).toBe('ep.png')
    expect(ep.body[0]).toEqual({ kind: 'p', parts: [{ kind: 'text', text: 'Store : cette ligne fait partie du texte.' }] })
    expect(ep.body[1]).toEqual({
      kind: 'list',
      items: [
        [{ kind: 'text', text: 'un ' }, { kind: 'image', alt: 'écran', src: 'ep2.png' }],
        [{ kind: 'link', text: 'guide', href: 'https://example.org/guide' }],
      ],
    })
    expect(doc.intro[0]).toEqual({ kind: 'p', parts: [{ kind: 'text', text: 'Intro ' }, { kind: 'bold', text: 'courte' }, { kind: 'text', text: '.' }] })
    expect(parseInline('sans rien')).toEqual([{ kind: 'text', text: 'sans rien' }])
  })

  it('adresses : fichier du dossier montre/, liens complets inchangés', () => {
    expect(docUrl('ep.png', '/Trail-Planner/')).toBe('/Trail-Planner/montre/ep.png')
    expect(docUrl('./ep.png', '/')).toBe('/montre/ep.png')
    expect(docUrl('https://x.org/a.png', '/Trail-Planner/')).toBe('https://x.org/a.png')
  })
})
