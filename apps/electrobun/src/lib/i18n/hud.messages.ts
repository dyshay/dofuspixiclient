import { msg } from "@lingui/core/macro";

export const statsTooltips = {
  energy: msg`Points d'énergie : perdus en cas de mort. Régénérés en se déconnectant dans une zone de sauvegarde.`,
  xp: msg`Points d'expérience : en gagnant suffisamment de points d'expérience, vous gagnez un niveau.`,
  hp: msg`Points de vie : si vos points de vie tombent à 0 en combat, vous êtes vaincu.`,
  ap: msg`Points d'action : utilisés pour lancer des sorts et effectuer des actions en combat.`,
  mp: msg`Points de mouvement : chaque case de déplacement en combat coûte 1 PM.`,
  initiative: msg`Initiative : détermine l'ordre de jeu en combat. Plus elle est élevée, plus vous jouez tôt.`,
  prospection: msg`Prospection : augmente vos chances de trouver des objets sur les monstres vaincus.`,
  vitality: msg`Vitalité : chaque point de vitalité augmente vos points de vie maximum de 1.`,
  wisdom: msg`Sagesse : augmente les points d'expérience gagnés et la résistance aux pertes de PA/PM.`,
  strength: msg`Force : augmente les dégâts de terre et le pods transportable.`,
  intelligence: msg`Intelligence : augmente les dégâts de feu et les soins.`,
  chance: msg`Chance : augmente les dégâts d'eau et la prospection.`,
  agility: msg`Agilité : augmente les dégâts d'air, l'esquive PA/PM et la fuite.`,
  capital: msg`Points de capital : utilisez-les pour augmenter vos caractéristiques.`,
  quill: msg`Plus de statistiques`,
};

export const statsLabels = {
  energy: msg`Energie`,
  xp: msg`Expérience`,
  hp: msg`Points de vie`,
  ap: msg`Points d'actions`,
  mp: msg`Points de mouvement`,
  initiative: msg`Initiative`,
  prospection: msg`Prospection`,
  characteristics: msg`Caractéristiques`,
  vitality: msg`Vitalité`,
  wisdom: msg`Sagesse`,
  strength: msg`Force`,
  intelligence: msg`Intelligence`,
  chance: msg`Chance`,
  agility: msg`Agilité`,
  capital: msg`Capital`,
  jobs: msg`Mes métiers`,
  specializations: msg`Spécialisations`,
  level: msg`Niveau {level}`,
  energyTip: msg`Énergie : {energy} / {maxEnergy}`,
  xpTip: msg`Expérience : {current} / {range} (niveau {level})`,
  boostTip: msg`+1 {name} : coûte {cost} point(s) de capital`,
};

export const worldMapLabels = {
  title: msg`Carte du monde`,
};

export const combatLabels = {
  pass: msg`Pass`,
  forfeit: msg`Forfeit`,
};
