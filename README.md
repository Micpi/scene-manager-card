# Scene Manager Card

Scene Manager Card est la carte Lovelace pour piloter **Scene Manager Ultimate**. Elle est publiee separement de l'integration afin de pouvoir mettre a jour l'interface via HACS sans mettre a jour le backend.

![Version](https://img.shields.io/badge/version-1.1.2-blue)
![HACS](https://img.shields.io/badge/HACS-Custom%20Card-orange)
![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Lovelace-41BDF5)

## Installation HACS

1. Ajoutez ce depot comme depot personnalise HACS de type **Lovelace**.
2. Installez **Scene Manager Card**.
3. Ajoutez la ressource si HACS ne le fait pas automatiquement :

```yaml
resources:
  - url: /hacsfiles/scene-manager-card/scene-manager-card.js
    type: module
```

L'integration backend reste separee :

```text
https://github.com/Micpi/ha-scene-manager-ultimate
```

La version `1.1.0` de la carte est prevue pour Scene Manager Ultimate `1.1.0` ou plus recent afin de profiter du switch live persistant et du service trace `scene_manager.activate_scene`.

Depuis `v1.1.1`, le menu d'edition de scene contient aussi un toggle **Mode live** pour activer ou desactiver directement `switch.scene_manager_live_mode` pendant la preparation d'une scene.
Depuis `v1.1.2`, ce toggle utilise un etat optimiste et le registre Scene Manager comme fallback pour rester synchronise meme pendant le delai de rafraichissement Home Assistant.

## Configuration rapide

```yaml
type: custom:scene-manager-card
title: Mes scenes
icon: mdi:home-floor-1
```

## Options

| Option | Type | Defaut | Description |
| --- | --- | --- | --- |
| `title` | string | `Mes Scènes` | Titre affiche en haut de la carte. |
| `icon` | string | `mdi:home-floor-1` | Icone du titre. |
| `show_title` | boolean | `true` | Affiche ou masque l'en-tete. |
| `room` | string | vide | Piece fixe a afficher. |
| `scene_prefix` | string | vide | Isole un groupe de scenes dans une meme piece. |
| `activation_transition` | number | `2` | Transition en secondes lors du declenchement. |
| `respect_live_mode` | boolean | `true` | Respecte le switch live de l'integration pendant l'edition. |
| `live_mode_entity` | string | `switch.scene_manager_live_mode` | Switch utilise pour autoriser les changements de lumieres en direct. |
| `action_source` | string | `card` | Source envoyee au service `scene_manager.activate_scene`. |
| `fallback_to_scene_service` | boolean | `true` | Utilise `scene.turn_on` si le service d'integration n'est pas disponible. |
| `auto_select_lights` | boolean | `true` | Selectionne automatiquement les lumieres allumees lors de la creation. |
| `show_empty` | boolean | `true` | Affiche le message quand aucune scene n'est disponible. |
| `empty_text` | string | `Aucune scène` | Message vide personnalise. |
| `manual_lights` | boolean | `false` | Active les pieces/lumieres configurees manuellement. |
| `manual_rooms` | list | `[]` | Liste de pieces manuelles et leurs lumieres. |
| `button_style` | string | `filled` | `filled`, `outline` ou `ghost`. |
| `button_shape` | string | `rounded` | `rounded`, `box` ou `circle`. |
| `scene_alignment` | string | `left` | `left`, `center` ou `right`. |
| `button_width` | string | `100px` | Largeur d'un bouton. |
| `button_height` | string | `80px` | Hauteur d'un bouton. |

## Exemples

### Piece fixe

```yaml
type: custom:scene-manager-card
title: Ambiances salon
room: salon
button_style: outline
activation_transition: 1.5
```

### Deux jeux de scenes dans la meme piece

```yaml
type: custom:scene-manager-card
title: Scenes cinema
room: salon
scene_prefix: cinema
```

```yaml
type: custom:scene-manager-card
title: Scenes repas
room: salon
scene_prefix: repas
```

### Edition sans live

```yaml
type: custom:scene-manager-card
title: Scenes bureau
room: bureau
respect_live_mode: true
live_mode_entity: switch.scene_manager_live_mode
```

### Pieces manuelles

```yaml
type: custom:scene-manager-card
manual_lights: true
manual_rooms:
  - id: salon
    name: Salon
    lights:
      - light.salon_canape
      - light.salon_tv
```
