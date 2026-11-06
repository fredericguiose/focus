// Paquet dialogues : fenêtres de focus-agent avec ncruces/zenity (natif sous Windows,
// programme zenity sous Linux).
package dialogues

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/agent"
	"github.com/ncruces/zenity"
)

const titre = "Focus"

type Zenity struct {
	Journal *slog.Logger
}

var _ agent.Dialogues = Zenity{}

// Disponible : sous Linux, faux si le programme zenity n'est pas installé.
func Disponible() bool { return zenity.IsAvailable() }

func annule(err error) error {
	if errors.Is(err, zenity.ErrCanceled) || errors.Is(err, zenity.ErrExtraButton) {
		return agent.ErrAnnule
	}
	return err
}

// Question : « J'arrête » (ou fermeture de la fenêtre) vaut arrêt, comme une absence de réponse.
func (Zenity) Question(ctx context.Context, texte string) (bool, error) {
	err := zenity.Question(texte, zenity.Title(titre), zenity.Context(ctx),
		zenity.OKLabel("Je continue"), zenity.CancelLabel("J'arrête"), zenity.NoWrap())
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, zenity.ErrCanceled) && ctx.Err() == nil:
		return false, nil
	case ctx.Err() != nil:
		return false, ctx.Err()
	default:
		return false, err
	}
}

func (Zenity) Patienter(ctx context.Context, texte string, duree time.Duration, annulable bool) error {
	secondes := max(int((duree+time.Second-1)/time.Second), 1)
	opts := []zenity.Option{zenity.Title(titre), zenity.Context(ctx), zenity.MaxValue(secondes)}
	if annulable {
		opts = append(opts, zenity.CancelLabel("Annuler"))
	} else {
		opts = append(opts, zenity.NoCancel())
	}
	dlg, err := zenity.Progress(opts...)
	if err != nil {
		return err
	}
	defer dlg.Close()
	fin := time.Now().Add(duree)
	tic := time.NewTicker(200 * time.Millisecond)
	defer tic.Stop()
	for {
		reste := time.Until(fin)
		if reste <= 0 {
			return nil
		}
		s := int((reste + time.Second - 1) / time.Second)
		_ = dlg.Text(fmt.Sprintf("%s %d s…", texte, s))
		_ = dlg.Value(secondes - s)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-dlg.Done():
			if time.Until(fin) <= 0 {
				return nil
			}
			return agent.ErrAnnule
		case <-tic.C:
		}
	}
}

func (Zenity) Choisir(ctx context.Context, texte string, options []string) (string, error) {
	choix, err := zenity.List(texte, options, zenity.Title(titre), zenity.Context(ctx),
		zenity.DisallowEmpty(), zenity.OKLabel("Choisir"), zenity.CancelLabel("Annuler"), zenity.Height(400))
	return choix, annule(err)
}

func (Zenity) Saisir(ctx context.Context, texte, defaut string) (string, error) {
	s, err := zenity.Entry(texte, zenity.Title(titre), zenity.Context(ctx), zenity.EntryText(defaut),
		zenity.OKLabel("Valider"), zenity.CancelLabel("Annuler"))
	return s, annule(err)
}

func (z Zenity) Informer(texte string) {
	if err := zenity.Info(texte, zenity.Title(titre), zenity.NoWrap()); err != nil && z.Journal != nil {
		z.Journal.Info(texte, "affichage", err)
	}
}

func (z Zenity) Prevenir(texte string) {
	if err := zenity.Notify(texte, zenity.Title(titre)); err != nil && z.Journal != nil {
		z.Journal.Warn("notification", "erreur", err)
	}
}

func (z Zenity) Erreur(texte string) {
	if err := zenity.Error(texte, zenity.Title(titre), zenity.NoWrap()); err != nil && z.Journal != nil {
		z.Journal.Error(texte, "affichage", err)
	}
}
