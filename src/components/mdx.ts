// Components available in every chapter/teaching MDX file without imports.
// Static diagrams: src/components/figures/*.astro (wrapped in ui/Figure.astro).
// To add a widget: create src/components/widgets/Foo.tsx, add a wrapper in
// src/components/embeds/Foo.astro (copy an existing one), and register it here.
import Answer from './ui/Answer.astro';
import Callout from './ui/Callout.astro';
import ListeningCue from './ui/ListeningCue.astro';
import Term from './ui/Term.astro';
import DataTable from './ui/DataTable.astro';
import SignalChain from './figures/SignalChain.astro';
import GroupingGrid from './figures/GroupingGrid.astro';
import LeapRegression from './figures/LeapRegression.astro';
import ScalePattern from './figures/ScalePattern.astro';
import KeyboardRef from './embeds/KeyboardRef.astro';
import GrooveLab from './embeds/GrooveLab.astro';
import GrooveComplexity from './embeds/GrooveComplexity.astro';
import Metronome from './embeds/Metronome.astro';
import IntervalQuiz from './embeds/IntervalQuiz.astro';
import HarmonicBuilder from './embeds/HarmonicBuilder.astro';
import HarmonicLadder from './embeds/HarmonicLadder.astro';
import StringModes from './embeds/StringModes.astro';
import MicSpectrum from './embeds/MicSpectrum.astro';
import BeatingLab from './embeds/BeatingLab.astro';
import ChordRoughness from './embeds/ChordRoughness.astro';
import IntervalExplorer from './embeds/IntervalExplorer.astro';
import TuningComparator from './embeds/TuningComparator.astro';
import CadenceLab from './embeds/CadenceLab.astro';
import BuildLab from './embeds/BuildLab.astro';
import SongMap from './embeds/SongMap.astro';
import StreamingLab from './embeds/StreamingLab.astro';
import FusionLab from './embeds/FusionLab.astro';
import MelodyLab from './embeds/MelodyLab.astro';
import SynthLab from './embeds/SynthLab.astro';

export const mdxComponents = {
  Answer,
  Callout,
  ListeningCue,
  Term,
  DataTable,
  SignalChain,
  GroupingGrid,
  LeapRegression,
  ScalePattern,
  KeyboardRef,
  GrooveLab,
  GrooveComplexity,
  Metronome,
  IntervalQuiz,
  HarmonicBuilder,
  HarmonicLadder,
  StringModes,
  MicSpectrum,
  BeatingLab,
  ChordRoughness,
  IntervalExplorer,
  TuningComparator,
  CadenceLab,
  BuildLab,
  SongMap,
  StreamingLab,
  FusionLab,
  MelodyLab,
  SynthLab,
};
