package catalog

import (
	"encoding/json"
	"fmt"
	"os"
)

type Signal struct {
	ID        int        `json:"id"`
	Name      string     `json:"name"`
	Unit      string     `json:"unit"`
	Scale     float64    `json:"scale"`
	Nominal   float64    `json:"nominal"`
	Sigma     float64    `json:"sigma"`
	Range     [2]float64 `json:"range"`
	Hard      [2]float64 `json:"hard"`
	Monitored bool       `json:"monitored"`
}

type DeviceType struct {
	Code     int      `json:"code"`
	Firmware string   `json:"firmware"`
	Primary  string   `json:"primary"`
	Commands []string `json:"commands"`
	Signals  []Signal `json:"signals"`
}

type Catalog struct {
	Types    map[string]*DeviceType `json:"types"`
	Commands map[string]int         `json:"commands"`
}

func Load(path string) (*Catalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("parse catalog: %w", err)
	}
	return &c, nil
}

func (t *DeviceType) SignalByID(id int) *Signal {
	for i := range t.Signals {
		if t.Signals[i].ID == id {
			return &t.Signals[i]
		}
	}
	return nil
}

func (t *DeviceType) HasCommand(name string) bool {
	for _, c := range t.Commands {
		if c == name {
			return true
		}
	}
	return false
}
