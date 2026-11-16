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
import FormStrips from './figures/FormStrips.astro'; // v5-05
import EqualLoudness from './figures/EqualLoudness.astro'; // v1-03
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
import PerceptLab from './embeds/PerceptLab.astro'; // v1-03
// v2-02
import MeterLab from './embeds/MeterLab.astro';
import MetricalGrid from './figures/MetricalGrid.astro';
// v3-05
import VoicingLab from './embeds/VoicingLab.astro';
import MotionTypes from './figures/MotionTypes.astro';
// v7-01
import EchoLab from './embeds/EchoLab.astro';
// v1-01
import WaveLab from './embeds/WaveLab.astro';
import SpringTrace from './figures/SpringTrace.astro';
// v4-08
import MixLab from './embeds/MixLab.astro';
import CompressorCurve from './figures/CompressorCurve.astro';
// v3-06
import ProgressionLab from './embeds/ProgressionLab.astro';
import HarmonicMap from './figures/HarmonicMap.astro';

// v1-06
import ExpectationLab from './embeds/ExpectationLab.astro';
import ItpraTimeline from './figures/ItpraTimeline.astro';
// v2-03
import SyncopationLab from './embeds/SyncopationLab.astro';
import GroupingMeter from './figures/GroupingMeter.astro';
// v3-08
import CounterpointLab from './embeds/CounterpointLab.astro';
import TextureTypes from './figures/TextureTypes.astro';
// v3-04
import ModeLab from './embeds/ModeLab.astro';
import ModeLadder from './figures/ModeLadder.astro';

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
  FormStrips, // v5-05
  EqualLoudness, // v1-03
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
  PerceptLab, // v1-03
  // v2-02
  MeterLab,
  MetricalGrid,
  // v3-05
  VoicingLab,
  MotionTypes,
  // v7-01
  EchoLab,
  WaveLab, // v1-01
  SpringTrace, // v1-01
  // v4-08
  MixLab,
  CompressorCurve,
  // v3-06
  ProgressionLab,
  HarmonicMap,
  // v1-06
  ExpectationLab,
  ItpraTimeline,
  // v2-03
  SyncopationLab,
  GroupingMeter,
  // v3-04
  ModeLab,
  ModeLadder,
  // v3-08
  CounterpointLab,
  TextureTypes,
};
