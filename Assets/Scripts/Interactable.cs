using UnityEngine;

public abstract class Interactable : MonoBehaviour
{
    public abstract InteractableTypes getInteractableType();
    public virtual void interact() {}
    public virtual void interact(Vector2 direction) {}
}
